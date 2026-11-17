# Empire X — logs entrepôt → stock + coffre (GRATUIT, via GitHub Actions)

Toutes les 5 minutes, GitHub lit les nouveaux messages du salon de logs et met à jour le site :
- « X a déposé 30x Vénia Purifier À 99 » → stock Venia +30 (À 99 et À 90 sont groupés)
- « X a retiré 50x Vénia Purifier À 90 » → stock Venia −50
- « X a déposé 15416x Argent Sale » → coffre +15 416 $ (retrait = coffre −)
- Les autres objets sont ignorés. L'historique ancien n'est PAS compté : seuls les messages
  arrivés après la première exécution comptent. Aucun message n'est compté deux fois.

## Étape 1 — Base de données (2 min)
Supabase (projet **Empire 1530**) > SQL Editor > colle tout `setup-bot.sql` > Run (« Success »).

## Étape 2 — Créer le bot Discord (5 min)
1. https://discord.com/developers/applications > **New Application** (nom : Empire Bot).
2. Menu **Bot** : active **Message Content Intent** (obligatoire), puis **Reset Token** et copie le token.
3. Menu **OAuth2 > URL Generator** : coche `bot` puis les permissions
   **View Channels** + **Read Message History**. Ouvre le lien généré et ajoute le bot à ton serveur
   (il faut le droit « Gérer le serveur »).
4. Vérifie que le bot a accès au salon des logs (permissions du salon).
5. ID du salon : Discord > Paramètres > Avancés > **Mode développeur**, puis clic droit sur le salon
   des logs > **Copier l'identifiant du salon**.

## Étape 3 — GitHub (10 min)
1. Crée un compte sur https://github.com puis **New repository** : nom `empire-bot`, **Public**.
2. Dans le dépôt : **Add file > Upload files** et glisse ces 5 fichiers (pas le dossier) :
   `parser.js`, `core.js`, `poll.js`, `package.json`, `README.md`.
3. **Add file > Create new file**. Dans le nom, tape exactement `.github/workflows/poll.yml`
   puis colle le contenu de `github-workflow-poll.yml`. Clique **Commit changes**.
4. **Settings > Secrets and variables > Actions > New repository secret**. Crée 4 secrets :
   - `DISCORD_TOKEN` = le token du bot
   - `LOG_CHANNEL_ID` = l'ID du salon
   - `SUPABASE_URL` = `https://meltmzpttixtgqtdvnxl.supabase.co`
   - `SUPABASE_KEY` = `sb_publishable_xiXBZd_8oy0L2v9So15OmQ_jT9xKYZf`
5. Onglet **Actions** > « Lecture des logs Discord » > **Run workflow** pour lancer un 1er test.
   Dans les logs tu dois voir « Initialisé : seuls les nouveaux messages seront comptés ».
   Ensuite ça tourne tout seul toutes les 5 minutes.

## Test
Fais un dépôt de 1 Venia en jeu, attends 5 à 10 min : le stock Venia du site doit monter de 1.

## À savoir
- GitHub peut retarder certains passages de quelques minutes. Rien n'est perdu : le prochain
  passage rattrape tout.
- Si le dépôt reste sans aucune activité pendant 60 jours, GitHub peut mettre la planification en
  pause : il suffit de cliquer **Enable workflow** dans l'onglet Actions.
- Une fois actif, ne saisis plus à la main le stock Venia/Héroïne ni l'argent sale (doublons).
- Le nom du joueur dans le log doit être le même que le nom du membre sur le site pour être relié.
- Pour suivre un autre objet : une ligne à ajouter dans `parser.js` (dis-le-moi).

## Version « serveur allumé 24h/24 » (facultatif)
`bot.js` fait la même chose en direct (instantané). Il faut `npm install discord.js dotenv`,
un fichier `.env` (voir `.env.example`) et un serveur toujours allumé.
