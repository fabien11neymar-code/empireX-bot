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

let membersCache = { ts: 0, rows: [] };
async function findMember(sb, name) {
  if (Date.now() - membersCache.ts > 60000) {
    const { data } = await sb.from('members').select('id,name');
    membersCache = { ts: Date.now(), rows: data || [] };
  }
  return membersCache.rows.find(m => norm(m.name) === norm(name)) || null;
}

// Traite une ligne de log. Lance une erreur si l'écriture échoue (pour réessayer plus tard).
async function handleLine(sb, raw, key) {
  const p = parseLine(raw);
  if (!p) return 'ignore';
  const cls = classifyItem(p.item);
  if (!cls) return 'ignore';
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
  }
  return 'ok';
}

async function handleMessage(sb, msg) {
  const lines = linesOf(msg);
  for (let i = 0; i < lines.length; i++) await handleLine(sb, lines[i], `${msg.id}-${i}`);
}

module.exports = { linesOf, handleLine, handleMessage };
