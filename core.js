// Logique commune (bot en continu + version GitHub Actions)
const { parseLine, classifyItem, norm } = require('./parser');

function linesOf(msg) {
  const out = [];
  if (msg.content) out.push(...msg.content.split('\n'));
  for (const e of msg.embeds || []) {
    if (e.title) out.push(e.title);
    if (e.description) out.push(...e.description.split('\n'));
    for (const f of e.fields || []) out.push(`${f.name} ${f.value}`);
  }
  return out;
}


// Retrouve le produit du site (onglet Stocks) correspondant au nom de l'objet du log.
// Comparaison sans accents/espaces/majuscules : "Cocaïne Pure À 80" -> produit "Cocaine", "Spore X" -> "SporeX".
const squash = s => norm(s).replace(/[^a-z0-9]/g, '');
let productsCache = { ts: 0, rows: [] };
async function resolveProduct(sb, item) {
  if (Date.now() - productsCache.ts > 30000) {
    const { data } = await sb.from('products').select('id,name');
    productsCache = { ts: Date.now(), rows: data || [] };
  }
  const n = squash(item);
  let best = null;
  for (const r of productsCache.rows) {
    const k = squash(r.name);
    if (k.length >= 3 && n.includes(k) && (!best || k.length > squash(best.name).length)) best = r;
  }
  return best;
}

let membersCache = { ts: 0, rows: [] };
async function findMember(sb, name) {
  if (Date.now() - membersCache.ts > 60000) {
    const { data } = await sb.from('members').select('id,name');
    membersCache = { ts: Date.now(), rows: data || [] };
  }
  return membersCache.rows.find(m => norm(m.name) === norm(name)) || null;
}

// Produits dont seule la version PURIFIÉE compte dans le stock (la brute est ignorée : elle sert à purifier).
// Noms sans accents/espaces/majuscules, comme dans l'onglet Stocks. Ajoute/retire ici selon tes drogues.
const PURE_ONLY = ['weed', 'mexicana', 'venia', 'cocaine'];
const isPure = item => /\bpur(e|es|ifie|ifier|ifiee)?\b/.test(norm(item));

// Mots-clés de drogue BRUTE sans produit dans Stocks (ex. Cannabis, Pochon de Mexicana) : pas de stock,
// mais si le joueur en RETIRE, ça compte comme "a pris de la drogue" pour le salaire. Ajoute tes mots ici.
const RAW_KEYWORDS = ['cannabis', 'pochon'];

// Enregistre un retrait de drogue brute (sans toucher au stock) : sert seulement à la règle du salaire.
async function logRawRetrait(sb, p, key) {
  const { error } = await sb.from('stock_logs').insert({
    id: key, player: p.player, action: p.action, qty: p.qty, item: p.item,
    kind: 'product', product_id: null, ts: new Date().toISOString(),
  });
  if (error && error.code !== '23505') throw new Error('stock_logs: ' + error.message);
  console.log(`  Retrait de drogue brute "${p.item}" par ${p.player} : stock inchangé, compte pour le salaire.`);
}

// Traite une ligne de log. Lance une erreur si l'écriture échoue (pour réessayer plus tard).
async function handleLine(sb, raw, key) {
  const p = parseLine(raw);
  if (!p) return 'ignore';
  const cls = classifyItem(p.item);
  if (!cls) return 'ignore';
  if (cls.kind === 'product' && cls.generic) {
    const prod = await resolveProduct(sb, p.item);
    if (!prod) {
      if (p.action === 'retrait' && RAW_KEYWORDS.some(k => norm(p.item).includes(k))) { await logRawRetrait(sb, p, key); return 'ok'; }
      console.log(`  Objet "${p.item}" : aucun produit correspondant dans Stocks -> ignoré.`); return 'ignore';
    }
    cls.productId = prod.id; cls.label = prod.name; cls.create = false;
    if (PURE_ONLY.includes(squash(prod.name)) && !isPure(p.item)) {
      if (p.action === 'retrait') { await logRawRetrait(sb, p, key); return 'ok'; }
      console.log(`  "${p.item}" : drogue brute de ${prod.name} (seule la pure compte) -> ignorée.`); return 'ignore';
    }
  }
  const sign = p.action === 'depot' ? 1 : -1;
  const member = await findMember(sb, p.player);

  // Journal avec clé unique : ne compte jamais deux fois le même message
  const { error: logErr } = await sb.from('stock_logs').insert({
    id: key, player: p.player, action: p.action, qty: p.qty, item: p.item,
    kind: cls.kind, product_id: cls.productId || null, ts: new Date().toISOString(),
  });
  if (logErr) {
    if (logErr.code === '23505') return 'deja-traite';
    throw new Error('stock_logs: ' + logErr.message);
  }

  if (cls.kind === 'product') {
    if (cls.create) {
      // crée le produit dans Stocks s'il n'existe pas encore (stock de départ 0)
      const { error: pErr } = await sb.from('products').upsert(
        { id: cls.productId, name: cls.label, stock: 0, low_stock: 0 }, { onConflict: 'id', ignoreDuplicates: true });
      if (pErr) throw new Error('products: ' + pErr.message);
    }
    const { error } = await sb.rpc('adjust_stock', { p_id: cls.productId, p_delta: sign * p.qty });
    if (error) throw new Error('adjust_stock: ' + error.message);
    console.log(`Stock ${cls.label} ${sign > 0 ? '+' : '-'}${p.qty} (${p.player})`);
  } else {
    const { error } = await sb.from('coffre').insert({
      id: 'dl-' + key, type: p.action, amount: p.qty,
      note: 'Entrepôt — Argent sale', member_id: member ? member.id : null,
      member_name: p.player, ts: new Date().toISOString(),
    });
    if (error) throw new Error('coffre: ' + error.message);
    console.log(`Coffre ${sign > 0 ? '+' : '-'}${p.qty} $ (${p.player})`);
    // Un DÉPÔT d'argent sale compte dans le salaire SEULEMENT si le joueur a retiré de la drogue récemment
    // (fenêtre DRUG_WINDOW_HOURS, 12 h par défaut). Sinon : coffre seulement, pas de salaire.
    // Pas de produit lié : le stock n'est pas touché, et le coffre n'est pas crédité une 2e fois.
    if (p.action === 'depot') {
      const hours = parseFloat(process.env.DRUG_WINDOW_HOURS || '12') || 12;
      const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
      const { data: recent, error: rErr } = await sb.from('stock_logs').select('id')
        .eq('player', p.player).eq('action', 'retrait').eq('kind', 'product').gte('ts', since).limit(1);
      if (rErr) throw new Error('stock_logs (recherche): ' + rErr.message);
      if (!recent || recent.length === 0) {
        console.log(`  Dépôt de ${p.qty} $ par ${p.player} : pas de retrait de drogue dans les ${hours} h -> coffre seulement, pas de salaire.`);
      } else {
        if (!member) console.warn(`  ⚠ "${p.player}" n'est pas un membre du site : le dépôt ne compte pas dans les salaires (le nom doit être identique).`);
        const { error: sErr } = await sb.from('sales').insert({
          id: 'dl-' + key, product_id: null, product_name: 'Dépôt entrepôt (argent sale)', qty: 1, total: p.qty,
          member_id: member ? member.id : null, member_name: p.player, coffre_added: false, ts: new Date().toISOString(),
        });
        if (sErr) throw new Error('sales: ' + sErr.message);
        console.log(`Salaire +${p.qty} $ pour ${p.player}`);
      }
    }
  }
  return 'ok';
}

async function handleMessage(sb, msg) {
  const lines = linesOf(msg);
  // Diagnostic : montre ce que le bot voit (texte du message, nombre d'embeds)
  console.log(`[msg ${msg.id}] auteur=${msg.author ? msg.author.username : '?'} | texte=${(msg.content || '').length} car. | embeds=${(msg.embeds || []).length} | lignes=${lines.length}`);
  if (lines.length === 0) console.log('  -> message VIDE : active "Message Content Intent" dans le portail Discord (Bot).');
  for (let i = 0; i < lines.length; i++) {
    console.log('  ligne: ' + lines[i].slice(0, 120));
    const r = await handleLine(sb, lines[i], `${msg.id}-${i}`);
    if (r === 'ignore') console.log('  -> ignorée (format ou objet non suivi)');
  }
}

module.exports = { linesOf, handleLine, handleMessage };
