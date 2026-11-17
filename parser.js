// Lecture des logs « Entrepôt » : "Joueur a déposé 30x Vénia Purifier À 99"
const norm = s => (s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();

function clean(text){
  return (text||'')
    .replace(/[*_`~>]/g,'')            // markdown Discord
    .replace(/[   ]/g,' ') // espaces insécables
    .replace(/\s+/g,' ')
    .trim();
}

// -> {player, action:'depot'|'retrait', qty, item} ou null
function parseLine(raw){
  const t = clean(raw);
  const m = t.match(/^(.+?) a (déposé|depose|déposée|retiré|retire|retirée) (\d[\d .,]*)x (.+)$/i);
  if(!m) return null;
  const qty = parseInt(m[3].replace(/[ .,]/g,''),10);
  if(!qty || qty<=0) return null;
  const verb = norm(m[2]);
  return { player:m[1].trim(), action: verb.startsWith('depos') ? 'depot' : 'retrait', qty, item:m[4].trim() };
}

// Objets à NE PAS suivre (mots-clés, sans accents/majuscules). Ajoute ici ce qui n'est pas de la drogue.
const IGNORE = ['nourriture', 'boitier darknet', 'table de jus'];

// Enlève la qualité/niveau en fin de nom : "Vénia Purifier À 99" -> "Vénia Purifier"
function baseName(item) {
  let s = item.trim();
  for (let i = 0; i < 3; i++) s = s.replace(/\s+(?:à|a)\s*\d+\s*%?$/i, '').replace(/\s+\d+\s*%?$/i, '');
  return s.trim();
}
function slug(s) { return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }

// -> {kind:'coffre'} | {kind:'product', productId, label, create:true} | null
function classifyItem(item) {
  const n = norm(item);
  if (n.includes('argent sale')) return { kind: 'coffre', label: 'Argent sale' };
  if (IGNORE.some(k => n.includes(k))) return null;
  if (n.includes('venia'))   return { kind: 'product', productId: 'venia',   label: 'Venia',   create: true };
  if (n.includes('heroine')) return { kind: 'product', productId: 'heroine', label: 'Héroïne', create: true };
  const label = baseName(item);
  const id = slug(label);
  if (!id) return null;
  return { kind: 'product', productId: id, label, create: true };
}

module.exports = { parseLine, classifyItem, norm, baseName };
