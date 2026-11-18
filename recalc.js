// RECALCUL des salaires : relit l'historique du salon depuis une date et ajoute les dépôts d'argent sale
// qui auraient dû compter dans le salaire (retrait de drogue brute/pure dans les X h avant) mais qui ont été manqués.
// Ne touche NI au coffre NI au stock. Sans danger : peut être relancé (un dépôt n'est ajouté qu'une fois).
//   DRY_RUN=true  (défaut) : affiche seulement ce qui serait ajouté
//   DRY_RUN=false          : ajoute vraiment
const { fetchNew } = require('./poll');
const { linesOf, resolveProduct, findMember, RAW_KEYWORDS } = require('./core');
const { parseLine, norm } = require('./parser');

const toSnowflake = ms => ((BigInt(ms) - 1420070400000n) << 22n).toString();

async function recalc({ sb, messages, apply, hours }) {
  const win = hours * 3600 * 1000;
  if (messages.length) console.log(`Dernier message relu : ${messages[messages.length-1].timestamp}`);
  const drug = {};            // joueur -> [timestamps de retraits de drogue]
  const deposits = [];        // dépôts d'argent sale
  for (const m of messages) {
    const ts = new Date(m.timestamp || Date.now()).getTime();
    const lines = linesOf(m);
    for (let i = 0; i < lines.length; i++) {
      const p = parseLine(lines[i]);
      if (!p) continue;
      const key = `${m.id}-${i}`;
      if (norm(p.item).includes('argent sale')) {
        if (p.action === 'depot') deposits.push({ p, key, ts });
      } else if (p.action === 'retrait') {
        const isDrug = (await resolveProduct(sb, p.item)) || RAW_KEYWORDS.some(k => norm(p.item).includes(k));
        if (isDrug) (drug[p.player] = drug[p.player] || []).push(ts);
      }
    }
  }
  // Ventes / actions déjà notées à la main (pas celles du bot) : un dépôt de même montant à ±3 h = même argent, on ne le recompte pas
  const manual = [];
  for (const [tbl, col] of [['sales', 'total'], ['actions', 'amount']]) {
    const { data } = await sb.from(tbl).select('*');
    for (const r of data || []) if (!String(r.id).startsWith('dl-')) manual.push({ tbl, amount: Math.round(r[col] || 0), ts: new Date(r.ts).getTime() });
  }
  const added = [], skipped = [];
  for (const d of deposits) {
    const had = (drug[d.p.player] || []).some(t => t <= d.ts && d.ts - t <= win);
    if (!had) { skipped.push(d); console.log(`SANS RETRAIT DE DROGUE AVANT : ${d.p.player} ${d.p.qty} $ (${new Date(d.ts).toLocaleString('fr-FR')}) -> ignoré`); continue; }
    const { data: ex } = await sb.from('sales').select('id').eq('id', 'dl-' + d.key).maybeSingle();
    if (ex) { console.log(`DÉJÀ COMPTÉ AU SALAIRE : ${d.p.player} ${d.p.qty} $ (${new Date(d.ts).toLocaleString('fr-FR')})`); continue; }
    const dup = manual.find(x => x.amount === Math.round(d.p.qty) && Math.abs(x.ts - d.ts) <= 3 * 3600 * 1000);
    if (dup) { console.log(`DÉJÀ NOTÉ À LA MAIN (${dup.tbl}) : ${d.p.player} ${d.p.qty} $ -> ignoré`); continue; }
    const member = await findMember(sb, d.p.player);
    console.log(`${apply ? 'AJOUT' : 'À AJOUTER'} : ${d.p.player} +${d.p.qty} $ (${new Date(d.ts).toLocaleString('fr-FR')})${member ? '' : '  ⚠ nom inconnu sur le site'}`);
    if (apply) {
      const { error } = await sb.from('sales').insert({
        id: 'dl-' + d.key, product_id: null, product_name: 'Dépôt entrepôt (argent sale)', qty: 1, total: d.p.qty,
        member_id: member ? member.id : null, member_name: d.p.player, coffre_added: false, ts: new Date(d.ts).toISOString(),
      });
      if (error) throw new Error('sales: ' + error.message);
    }
    added.push(d);
  }
  console.log(`\n${added.length} dépôt(s) ${apply ? 'ajouté(s)' : 'à ajouter'} au salaire, ${skipped.length} sans retrait de drogue avant (ignorés).`);
  if (!apply && added.length) console.log('Relance avec DRY_RUN=false pour les ajouter vraiment.');
  return { added, skipped };
}
module.exports = { recalc, toSnowflake };

if (require.main === module) {
  (async () => {
    const { DISCORD_TOKEN, LOG_CHANNEL_ID, SUPABASE_URL, SUPABASE_KEY, SINCE } = process.env;
    for (const [k, v] of Object.entries({ DISCORD_TOKEN, LOG_CHANNEL_ID, SUPABASE_URL, SUPABASE_KEY, SINCE })) {
      if (!v) { console.error('Variable manquante : ' + k); process.exit(1); }
    }
    const since = new Date(SINCE + 'T00:00:00Z').getTime();
    if (isNaN(since)) { console.error('SINCE doit être au format AAAA-MM-JJ'); process.exit(1); }
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
    const apply = String(process.env.DRY_RUN || 'true').toLowerCase() === 'false';
    const hours = parseFloat(process.env.DRUG_WINDOW_HOURS || '12') || 12;
    // on remonte 12 h avant la date de départ pour voir les retraits de drogue qui précèdent
    const messages = await fetchNew(LOG_CHANNEL_ID, DISCORD_TOKEN, toSnowflake(since - hours * 3600 * 1000));
    console.log(`${messages.length} message(s) relus depuis le ${SINCE}.  Mode : ${apply ? 'AJOUT RÉEL' : 'SIMULATION'}\n`);
    await recalc({ sb, messages, apply, hours });
  })().catch(e => { console.error(e.message || e); process.exit(1); });
}
