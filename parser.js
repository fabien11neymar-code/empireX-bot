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

// Quels objets suivre : drogue (groupée par produit) + argent sale (coffre)
// -> {kind:'coffre'} | {kind:'product', productId, label} | null
function classifyItem(item){
  const n = norm(item);
  if(n.includes('argent sale')) return {kind:'coffre', label:'Argent sale'};
  if(n.includes('venia'))   return {kind:'product', productId:'venia',   label:'Venia'};
  if(n.includes('heroine')) return {kind:'product', productId:'heroine', label:'Héroïne'};
  return null;
}

module.exports = { parseLine, classifyItem, norm };
