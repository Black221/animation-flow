# animation-flow

Générer des animations à partir d'une interface web. Une animation est décrite dans un **format de données** (JSON
validé) : ce qui se passe à l'écran, pas la façon de le dessiner. Le même projet se prévisualise en direct dans
l'éditeur et se rend dans **plusieurs styles** (vectoriel plat, aquarelle…). Les modèles d'IA sont **au choix** :
chaque équipe enregistre ses propres clés d'API et choisit un modèle par tâche.

État : **étapes 1 à 5** (fondations, rendu vidéo, narration et son, génération par IA, multi-utilisateur). Voir la
[Feuille de route](#feuille-de-route) pour la suite.

## Démarrer

Prérequis : Node 22+, pnpm 10 (`corepack enable`), FFmpeg (pour le rendu vidéo).

```bash
pnpm install
pnpm dev            # API sur :3000 (base PostgreSQL embarquée, PGlite) + éditeur sur http://localhost:5173
```

Sans `DATABASE_URL`, l'API utilise une base PostgreSQL embarquée (PGlite) dans `.data/`, et génère une clé de
chiffrement de développement dans `.data/` (jamais versionnée). Rien d'autre à installer.

Au premier lancement, l'éditeur demande de créer le **premier compte** : il devient propriétaire de l'espace de
travail (et de tout ce qui existait avant les comptes), puis invite l'équipe depuis la page **Équipe**.

### Avec Docker (application + PostgreSQL)

```bash
cp .env.example .env              # puis remplir APP_ENCRYPTION_KEY : openssl rand -base64 32
docker compose up --build         # → http://localhost:3000
docker compose --profile workers up --build --scale worker=2   # avec deux machines de rendu en plus
# plusieurs processus d'API derrière un répartiteur de charge (nginx, deploy/nginx.conf), sans affinité :
docker compose -f docker-compose.yml -f docker-compose.cluster.yml up --build --scale app=2
```

Vérifié ainsi : deux répliques de l'API derrière nginx, un worker de rendu, PostgreSQL ; quatre personnes sur le
même projet, dont les connexions en direct se répartissent sur les deux répliques, voient les modifications des
autres ; les migrations passent une seule fois ; le rendu est pris par le worker ; l'e-mail de mot de passe oublié
part avec un lien construit sur `APP_URL`.

## Ce que fait l'application

- **Équipes** : comptes (e-mail + mot de passe), espaces de travail, rôles *lecteur* (consulte, regarde),
  *éditeur* (édite, voix, rendus, IA), *administrateur* (clés d'API, modèles, membres, invitations) et
  *propriétaire* (transmet la propriété, supprime l'espace). On invite par un lien à usage unique (7 jours, rôle
  choisi, éventuellement réservé à une adresse). Une personne peut appartenir à plusieurs espaces et passer de l'un
  à l'autre ; chaque espace a ses projets, ses clés, ses voix, ses rendus et ses générations, et ne voit rien des
  autres. Chaque version d'un projet garde son auteur.
- **Création par IA** : coller un texte (script, résumé, idée) ; le modèle choisi écrit un **storyboard** (scènes,
  répliques, intentions de plan) que l'on relit et corrige, puis **chaque scène** au format d'animation. Chaque
  réponse est vérifiée (schéma + bibliothèque) ; en cas d'erreur, le modèle reçoit la liste des problèmes et corrige
  (deux fois au plus) ; une scène qui reste invalide est remplacée par une scène simple tirée du storyboard, signalée.
  Dans l'éditeur, « Modifier » demande à l'IA de retoucher la scène ouverte (annulable). Tokens et appels sont
  affichés à chaque étape.
- **Projets** : créer (exemple « Awa et Jumo » ou projet vide), ouvrir, enregistrer. Chaque version garde son auteur.
- **Édition à plusieurs en temps réel** : les membres qui ouvrent le même projet voient les modifications des autres
  au fil de la frappe, qui est là (pastilles dans la barre, point sur la scène où chacun se trouve) et l'état de
  l'enregistrement. Deux personnes qui touchent des champs différents se complètent ; sur le même champ, la dernière
  arrivée au serveur l'emporte ; une modification qui ne s'applique plus (scène supprimée entre-temps) ou qui rendrait
  le projet invalide est refusée avec la raison. Les scènes, éléments et répliques sont repérés par leur identifiant :
  une retouche de la scène `s2` reste sur `s2` même si quelqu'un insère une scène avant. Le texte JSON ouvert suit
  les modifications des autres, sans perdre le curseur. Enregistrement automatique (une version par séance et par
  auteur) ; « Enregistrer » (ou Ctrl+S) clôt la version en cours. Un lecteur suit en direct sans pouvoir modifier.
  Sans WebSocket (vieux proxy), l'éditeur revient à l'enregistrement à la main, qui détecte les conflits.
- **Commentaires** (onglet « Commentaires ») : un fil sur une scène, éventuellement sur un élément et à un instant
  de la scène (le lien « à 0:02.0 » y ramène la lecture) ; réponses, fils résolus ou rouverts, nombre de fils ouverts
  sur chaque scène. Tout membre commente, lecteurs compris ; les éditeurs (et l'auteur) résolvent ; l'auteur ou un
  administrateur supprime. Les commentaires arrivent en direct chez ceux qui ont le projet ouvert.
- **Aperçu en direct** dans chaque style, lecture, déplacement dans le temps, sous-titres, frise des scènes et des répliques.
- **Édition** d'une scène ou de la distribution en JSON : chaque frappe valide est appliquée à l'aperçu, une erreur est
  expliquée avec son chemin (`scenes.0.elements.2.ref`) et n'atteint jamais le projet.
- **Contrôle par la bibliothèque** : décor, accessoire, pose ou expression inconnus sont signalés (et dessinés comme
  un repère « ? » au lieu de faire échouer l'image).
- **Sous-titres** `.srt` exportés depuis l'horloge des répliques.
- **Narration** (onglet « Voix ») : chaque réplique est dite par le fournisseur de voix choisi (Fish Audio, ElevenLabs,
  OpenAI), avec la voix du narrateur ou celle du personnage. La durée mesurée remplace l'estimation : l'horloge de la
  scène suit la vraie voix. Une réplique n'est jamais payée deux fois (même texte, même voix → même fichier) ; si son
  texte change, elle est signalée « texte modifié ».
- **Musique et bruitages** synthétisés (aucun fichier, aucune licence) : une ambiance par scène (`calm`, `curious`,
  `playful`, `epic`, `night`, `tense`) et des bruitages calés sur les répliques (`pop`, `whoosh`, `chime`, `stamp`…).
- **Son dans l'aperçu** : voix, musique et bruitages mixés dans le navigateur avec le même code que le rendu.
- **Rendu vidéo** depuis l'éditeur (panneau « Vidéo ») : style, largeur (640 à 1920 px), qualité, film entier ou une
  scène, sous-titres intégrés comme piste. Le rendu porte sur la version enregistrée ; la progression s'affiche en direct,
  on peut l'annuler, puis regarder ou télécharger le MP4 (H.264 + AAC, sonie −16 LUFS). Le rendu signale les répliques
  encore sans voix.
- **Fournisseurs de modèles** : Anthropic, OpenAI, Google Gemini, Mistral, OpenRouter, serveur local compatible OpenAI
  (Ollama, LM Studio, vLLM), et pour la voix Fish Audio et ElevenLabs. Plusieurs clés par fournisseur, test de la clé,
  liste des modèles, un modèle par tâche (storyboard, scènes, narration).

## Sécurité des clés

- Les clés sont **chiffrées** (AES-256-GCM) avant d'entrer en base, avec `APP_ENCRYPTION_KEY` (variable d'environnement).
- Une clé enregistrée n'est **jamais renvoyée** au navigateur : l'interface n'affiche que `…a3F9`. On la remplace ou on la supprime.
- Seul le serveur la déchiffre, au moment d'appeler le fournisseur. Les en-têtes d'authentification sont masqués dans les journaux.
- Les clés appartiennent à un espace : seuls ses administrateurs les ajoutent, les testent et les remplacent.
- Par défaut le serveur n'écoute que sur la machine locale ; mettez un proxy HTTPS devant avant de l'exposer.

## Comptes et sécurité

- Mots de passe : 10 caractères au moins, hachés avec scrypt (sel aléatoire), comparés en temps constant ; une
  connexion à une adresse inconnue prend le même temps qu'avec un mauvais mot de passe.
- Session : un jeton aléatoire dans un cookie `HttpOnly`, `SameSite=Lax`, `Secure` derrière HTTPS ; la base ne garde
  que son empreinte SHA-256. 30 jours, prolongés à l'usage ; changer son mot de passe ferme les autres sessions.
- Toute écriture exige l'en-tête `x-requested-with: animation-flow` (protection CSRF : une page d'un autre site ne
  peut pas l'envoyer, le serveur n'autorisant aucune origine étrangère).
- Tentatives de connexion limitées (10 par adresse e-mail et par IP sur 15 minutes).
- Chaque route déclare le rôle qu'elle exige ; une route qui oublie de le dire est réservée aux membres, jamais ouverte.
- Inscription : `SIGNUP=invite` (défaut : le premier compte, puis sur invitation) ou `SIGNUP=open` (chacun crée
  son compte et reçoit son propre espace).
- **E-mail** (facultatif, `SMTP_URL` + `MAIL_FROM` + `APP_URL`) : l'invitation part directement à l'adresse saisie
  (le lien reste affiché, au cas où l'envoi échoue) ; « Mot de passe oublié ? » envoie un lien à usage unique,
  valable une heure. La réponse est la même qu'un compte existe ou non (on ne peut pas s'en servir pour deviner qui
  a un compte) ; demandes limitées (5 par heure, par adresse et par IP) ; seul le dernier lien demandé fonctionne ;
  changer son mot de passe ainsi ferme toutes les sessions, connexions en direct comprises. Les liens sont construits
  à partir d'`APP_URL`, jamais de l'en-tête `Host` de la requête (qui pourrait être falsifié). Sans e-mail, on
  transmet le lien d'invitation soi-même, et le mot de passe se change depuis le profil.
  Pour vérifier les réglages auprès de votre fournisseur (identifiants, port, chiffrement) avant d'inviter qui que
  ce soit : `docker compose exec app node dist/main.js --mail-test vous@example.org` (ou, en développement,
  `pnpm --filter @af/api exec tsx src/main.ts --mail-test vous@example.org`). La commande dit si le message est
  parti ou donne la réponse du serveur (par exemple `535` : identifiants refusés), sans jamais afficher le mot de
  passe. `smtps://` chiffre dès la connexion (port 465 par défaut) ; `smtp://` passe en chiffré (STARTTLS) quand le
  serveur le propose (port 587 par défaut ; `?requireTLS=true` l'exige). Un certificat que Node ne peut pas vérifier
  est refusé ; une autorité privée s'ajoute avec `NODE_EXTRA_CA_CERTS`.

## Configuration

| variable | rôle |
|---|---|
| `DATABASE_URL` | `postgres://…` ; sans elle, base embarquée PGlite dans `DATA_DIR` |
| `APP_ENCRYPTION_KEY` | 32 octets en base64 ou hexadécimal ; **obligatoire en production**. La changer rend les clés stockées illisibles |
| `SIGNUP` | `invite` (défaut) ou `open` : qui peut créer un compte |
| `COOKIE_SECURE` | `true` / `false` : force l'attribut `Secure` du cookie de session (défaut : selon HTTPS) |
| `PORT`, `HOST` | écoute (défaut `3000`, `127.0.0.1`) |
| `DATA_DIR` | données locales (défaut `.data`) |
| `WEB_DIST` | éditeur construit à servir (défaut `../web/dist`) |
| `ROLE` | `all` (défaut : API + rendu dans le même processus), `api`, ou `worker` (rendu seul ; demande PostgreSQL et un `RENDERS_DIR` partagé) |
| `TRUST_PROXY` | derrière un proxy inverse ou un répartiteur : `true`, un nombre de relais, ou leurs adresses (`10.0.0.0/8,…`). L'API voit alors la vraie adresse du client (limites de connexion par personne) et le protocole d'origine. À laisser vide si l'application est jointe directement : un client pourrait sinon choisir l'adresse sous laquelle il est vu |
| `RENDERS_DIR` | dossier des vidéos (défaut `DATA_DIR/renders`) |
| `VOICES_DIR` | répliques enregistrées, une par texte et par voix (défaut `DATA_DIR/voices`) |
| `RENDER_THREADS` | threads par rendu (défaut : nombre de cœurs − 1) |
| `FONTS_DIR` | polices du rendu serveur (défaut : celles de l'éditeur) |
| `FFMPEG_PATH`, `FFPROBE_PATH` | binaires FFmpeg (défaut : ceux du `PATH`) |
| `SMTP_URL` | `smtp://` ou `smtps://utilisateur:mot-de-passe@serveur:port` : active l'envoi d'e-mails (invitations, mot de passe oublié) |
| `MAIL_FROM` | expéditeur, par exemple `animation-flow <noreply@example.org>` (obligatoire avec `SMTP_URL`) |
| `APP_URL` | adresse publique de l'application, par exemple `https://anim.example.org` (obligatoire avec `SMTP_URL` : les liens des e-mails en partent) |

Derrière un proxy inverse (nginx, Caddy, Traefik), laisser passer les WebSocket (`Upgrade`) sur
`/api/projects/<id>/live` et transmettre `Host` (ou `X-Forwarded-Host`) : le serveur compare l'origine de la page à
son propre nom. Plusieurs instances de l'API peuvent tourner derrière un répartiteur de charge, sans affinité : elles
partagent l'édition en direct par PostgreSQL (il faut `DATABASE_URL` ; la base embarquée ne sert qu'un processus).

## Générer avec l'IA

1. **Réglages → Fournisseurs** : une clé de modèle de texte (Anthropic, OpenAI, Google Gemini, Mistral, OpenRouter,
   ou un serveur local compatible OpenAI comme Ollama), puis un modèle pour « Texte → storyboard » et un pour
   « Storyboard → scènes » (ils peuvent être différents : un grand modèle pour le récit, un plus rapide pour les scènes).
2. **Projets → Créer avec l'IA** : le texte, la langue de la narration, le style, une durée visée. Avec « relire le
   storyboard », la génération s'arrête après le storyboard : on corrige titres, décors, ambiances, répliques et plans,
   puis « Écrire les scènes ». Sans relecture, tout s'enchaîne.
3. Le projet créé s'ouvre dans l'éditeur : enregistrer les voix, retoucher, rendre la vidéo.

Les consignes données aux modèles (`packages/ai/src/prompts.ts`) décrivent le format, les conventions d'écran et le
catalogue exact de la bibliothèque (personnages, poses, expressions, accessoires, décors, ambiances, bruitages) :
un modèle ne peut demander que ce qui existe. La narration validée dans le storyboard est reprise telle quelle dans
les scènes. Selon le fournisseur, le JSON est imposé par un outil (Anthropic), un schéma (OpenAI), le mode JSON
(Gemini, Mistral, OpenRouter) ou la seule consigne (serveurs locaux) ; la validation et les corrections font le reste.

## Narration et son

1. **Réglages → Fournisseurs** : ajouter une clé de voix (Fish Audio, ElevenLabs ou OpenAI), puis, pour la tâche
   « Narration », choisir la clé, le modèle et la voix du narrateur (OpenAI : voix intégrées ; Fish Audio et
   ElevenLabs : « Tester » la clé liste vos voix). Un personnage peut avoir sa voix : champ `voice` dans la distribution.
2. **Éditeur → onglet Voix** : « Enregistrer les voix manquantes ». Chaque réplique est synthétisée, ses silences
   coupés, sa sonie ramenée à −18 LUFS, sa durée mesurée et écrite dans le projet.
3. **Musique et bruitages** : dans le JSON de la scène, `"music": { "mood": "curious", "gain": 0 }` et
   `"sfx": [{ "t": { "line": "l5", "offset": 0.3 }, "kind": "pop" }]`.

Le mixage (`packages/audio`) : voix au centre, musique calée 8 LU sous la voix et baissée de 8 dB de plus quand
quelqu'un parle, bruitages, puis sonie intégrée ramenée à −16 LUFS (mesure ITU-R BS.1770, vérifiée contre FFmpeg)
et crêtes réelles (entre les échantillons) limitées à −2 dBTP, pour rester sous −1 dBTP après l'encodage AAC. Environ une seconde de calcul pour une minute de film.

## Rendre une vidéo

Depuis l'éditeur, ou en ligne de commande :

```bash
pnpm --filter @af/render render -- --out=out/film.mp4 --style=watercolor --width=1920 --threads=3   # projet d'exemple
pnpm --filter @af/render render -- --project=mon-projet.json --from=0 --to=10 --width=1280
```

Le moteur et les styles de l'éditeur tournent dans Node (Canvas 2D, sans navigateur ni GPU). Les images sont
réparties en blocs rendus en parallèle, chacun envoyé directement à FFmpeg, puis les morceaux sont joints sans
réencodage et la narration est ajoutée comme piste de sous-titres. Ordre de grandeur sur 4 cœurs, en aquarelle :
les 42 s de l'exemple en 26 s en 1280 × 720 et en 43 s en 1920 × 1080.

Les rendus attendent dans une file stockée dans PostgreSQL (pas de service en plus). Chaque worker prend un rendu à la
fois ; un rendu dont le worker ne donne plus signe de vie repart dans la file (deux essais au plus). Les vidéos sont
servies par des liens signés valables une heure.

Le MP4 est en H.264 : Chrome, Edge, Firefox et Safari le lisent ; les versions libres de Chromium non (l'éditeur
propose alors de télécharger le fichier).

## Vérifier

GitHub Actions ne démarre pas de tâche sur ce compte pour l'instant : le workflow `.github/workflows/ci.yml` ne se
lance qu'à la main. Tout se vérifie en local :

```bash
pnpm typecheck
pnpm test                                    # schéma, moteur, styles (rendu Node), fournisseurs, API (PGlite)
TEST_DATABASE_URL=postgres://… pnpm vitest run apps/api --no-file-parallelism   # l'API sur un vrai PostgreSQL (base effacée !)
pnpm e2e                                     # éditeur complet dans Chromium (Playwright)
CLUSTER_DATABASE_URL=postgres://… pnpm --filter @af/web e2e:cluster   # deux processus d'API, un navigateur sur chacun (base effacée !)
pnpm --filter @af/styles still -- --style=watercolor --t=1,4,9   # images fixes dans out/stills
```

## Organisation

| chemin | rôle |
|---|---|
| `packages/schema` | le format d'animation (Zod), validation, schéma JSON, projet d'exemple |
| `packages/engine` | horloge des répliques, images clés, caméra, calcul d'une image en primitives, sous-titres |
| `packages/library` | personnages (`person`, `drone`), accessoires, décors, textes : indépendants du style |
| `packages/styles` | packs de style `flat` et `watercolor` (Canvas 2D : navigateur et Node, sans GPU) |
| `packages/providers` | fournisseurs : catalogue, test d'une clé, modèles de texte (`complete`), synthèse vocale |
| `packages/ai` | génération : storyboard, scènes, correction guidée par les erreurs, scène de secours, retouche |
| `packages/audio` | musique et bruitages synthétisés, placement des voix, mixage, sonie (navigateur et Node) |
| `packages/render` | rendu vidéo : moteur + style dans Node, blocs parallèles, FFmpeg, MP4 avec son et sous-titres |
| `apps/api` | Fastify : comptes et équipes, projets versionnés, clés chiffrées, fournisseurs, file et workers de rendu ; sert l'éditeur construit |
| `apps/web` | l'éditeur (Vite + React) |

Détails : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Feuille de route

1. **Fondations** (fait) : format, moteur, deux styles, éditeur avec aperçu, fournisseurs et clés, Docker.
2. **Rendu serveur** (fait) : file de tâches dans PostgreSQL, workers qui rendent par blocs en parallèle, MP4 (FFmpeg) avec sous-titres, progression en direct, liens signés.
3. **Narration et son** (fait) : voix par réplique avec le fournisseur choisi (durées mesurées → l'horloge se recale seule), musique et bruitages synthétisés, mixage −16 LUFS, son dans l'aperçu et dans le MP4.
4. **Génération par IA** (fait) : texte → storyboard relu → scènes validées (corrections guidées, scène de secours), retouche d'une scène dans l'éditeur, tokens affichés.
5. **Multi-utilisateur** (fait) : comptes, espaces de travail, rôles, invitations, isolation des données, auteur de chaque version.
6. **Travail d'équipe** (fait) : édition à plusieurs en temps réel, commentaires sur les scènes, invitations et mot de passe oublié par e-mail.
7. **Ensuite** : modèles de projets, packs de styles supplémentaires.

## Crédits

Polices : Fredoka et Patrick Hand (SIL Open Font License), Permanent Marker (Apache 2.0), dans `apps/web/public/fonts`
avec leurs licences. Le projet d'exemple reprend l'ouverture du court métrage « Awa et Jumo : la quête du jumeau stratégique ».
