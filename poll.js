// Version « sans serveur » : lancé toutes les 5 min par GitHub Actions.
// Lit les nouveaux messages du salon depuis le dernier passage et met à jour le site.
const CURSOR_ID = 'discord_cursor';
const API = 'https://discord.com/api/v10';

async function fetchNew(channelId, token, afterId) {
  // Discord renvoie du plus récent au plus ancien, 100 max : on boucle
  const all = [];
  let after = afterId;
  for (let page = 0; page < 150; page++) {
    const url = `${API}/channels/${channelId}/messages?limit=100` + (after ? `&after=${after}` : '');
    const r = await fetch(url, { headers: { Authorization: `Bot ${token}` } });
    if (!r.ok) throw new Error(`Discord ${r.status}: ${await r.text()}`);
    const batch = await r.json();
    if (!batch.length) break;
    all.push(...batch);
    after = batch.map(m => BigInt(m.id)).reduce((a, b) => (a > b ? a : b)).toString();
    if (batch.length < 100) break;
  }
  return all.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
}

async function getCursor(sb) {
  const { data } = await sb.from('bot_state').select('value').eq('id', CURSOR_ID).maybeSingle();
  return data ? data.value : null;
}
async function setCursor(sb, value) {
  const { error } = await sb.from('bot_state').upsert({ id: CURSOR_ID, value });
  if (error) throw new Error('bot_state: ' + error.message);
}

async function runOnce({ sb, fetchMessages, handleMessage }) {
  const cursor = await getCursor(sb);
  if (!cursor) {
    // Premier lancement : on se place sur le dernier message SANS rien compter (pas d'historique)
    const latest = await fetchMessages(null, true);
    const id = latest.length ? latest[latest.length - 1].id : '0';
    await setCursor(sb, id);
    console.log('Initialisé : seuls les nouveaux messages seront comptés. Curseur = ' + id);
    return { initialized: true, processed: 0 };
  }
  const msgs = await fetchMessages(cursor, false);
  let processed = 0, last = cursor;
  for (const m of msgs) {
    await handleMessage(sb, m);           // si ça échoue : on s'arrête, le curseur n'avance pas
    last = m.id; processed++;
    await setCursor(sb, last);
  }
  console.log(`${processed} message(s) lu(s).`);
  return { initialized: false, processed };
}

module.exports = { runOnce, fetchNew };

if (require.main === module) {
  (async () => {
    const { DISCORD_TOKEN, LOG_CHANNEL_ID, SUPABASE_URL, SUPABASE_KEY } = process.env;
    for (const [k, v] of Object.entries({ DISCORD_TOKEN, LOG_CHANNEL_ID, SUPABASE_URL, SUPABASE_KEY })) {
      if (!v) { console.error('Secret manquant : ' + k); process.exit(1); }
    }
    const { createClient } = require('@supabase/supabase-js');
    const { handleMessage } = require('./core');
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
    const fetchMessages = async (after, firstRun) => {
      if (firstRun) {
        const r = await fetch(`${API}/channels/${LOG_CHANNEL_ID}/messages?limit=1`, { headers: { Authorization: `Bot ${DISCORD_TOKEN}` } });
        if (!r.ok) throw new Error(`Discord ${r.status}: ${await r.text()}`);
        return await r.json();
      }
      return fetchNew(LOG_CHANNEL_ID, DISCORD_TOKEN, after);
    };

    // Mode « boucle » : lit le salon toutes les INTERVAL_SECONDS pendant LOOP_SECONDS (délai ~20 s au lieu de 5 min)
    const loopMs = (parseInt(process.env.LOOP_SECONDS || '0', 10) || 0) * 1000;
    const everyMs = Math.max(5, parseInt(process.env.INTERVAL_SECONDS || '20', 10) || 20) * 1000;
    const end = Date.now() + loopMs;
    let ok = 0, fail = 0;
    do {
      try { await runOnce({ sb, handleMessage, fetchMessages }); ok++; }
      catch (e) { fail++; console.error(e.message || e); }
      if (Date.now() + everyMs >= end) break;
      await new Promise(r => setTimeout(r, everyMs));
    } while (Date.now() < end);
    console.log(`Terminé : ${ok} lecture(s) réussie(s), ${fail} erreur(s).`);
    if (ok === 0) process.exit(1);
  })().catch(e => { console.error(e); process.exit(1); });
}
