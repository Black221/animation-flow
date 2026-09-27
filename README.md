# animation-flow

Générer des animations à partir d'une interface web. Une animation est décrite dans un **format de données** (JSON
validé) : ce qui se passe à l'écran, pas la façon de le dessiner. Le même projet se prévisualise en direct dans
l'éditeur et se rend dans **plusieurs styles** (vectoriel plat, aquarelle…). Les modèles d'IA sont **au choix** :
chaque équipe enregistre ses propres clés d'API et choisit un modèle par tâche.

État : **étapes 1 à 4** (fondations, rendu vidéo, narration et son, génération par IA). Voir la
[Feuille de route](#feuille-de-route) pour la suite.

## Démarrer

Prérequis : Node 22+, pnpm 10 (`corepack enable`), FFmpeg (pour le rendu vidéo).

```bash
pnpm install
pnpm dev            # API sur :3000 (base PostgreSQL embarquée, PGlite) + éditeur sur http://localhost:5173
```

Sans `DATABASE_URL`, l'API utilise une base PostgreSQL embarquée (PGlite) dans `.data/`, et génère une clé de
chiffrement de développement dans `.data/` (jamais versionnée). Rien d'autre à installer.

### Avec Docker (application + PostgreSQL)

```bash
cp .env.example .env              # puis remplir APP_ENCRYPTION_KEY : openssl rand -base64 32
docker compose up --build         # → http://localhost:3000
docker compose --profile workers up --build --scale worker=2   # avec deux machines de rendu en plus
```

## Ce que fait l'application

- **Création par IA** : coller un texte (script, résumé, idée) ; le modèle choisi écrit un **storyboard** (scènes,
  répliques, intentions de plan) que l'on relit et corrige, puis **chaque scène** au format d'animation. Chaque
  réponse est vérifiée (schéma + bibliothèque) ; en cas d'erreur, le modèle reçoit la liste des problèmes et corrige
  (deux fois au plus) ; une scène qui reste invalide est remplacée par une scène simple tirée du storyboard, signalée.
  Dans l'éditeur, « Modifier » demande à l'IA de retoucher la scène ouverte (annulable). Tokens et appels sont
  affichés à chaque étape.
- **Projets** : créer (exemple « Awa et Jumo » ou projet vide), ouvrir, enregistrer. Chaque enregistrement crée une
  version ; deux personnes qui éditent en même temps ne s'écrasent pas (l'éditeur propose de recharger ou de garder la sienne).
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
- Optionnel : `APP_ACCESS_TOKEN` protège toute l'API par un jeton partagé par l'équipe (demandé une fois par l'éditeur).
- Par défaut le serveur n'écoute que sur la machine locale ; mettez un proxy HTTPS devant avant de l'exposer.

## Configuration

| variable | rôle |
|---|---|
| `DATABASE_URL` | `postgres://…` ; sans elle, base embarquée PGlite dans `DATA_DIR` |
| `APP_ENCRYPTION_KEY` | 32 octets en base64 ou hexadécimal ; **obligatoire en production**. La changer rend les clés stockées illisibles |
| `APP_ACCESS_TOKEN` | jeton d'accès partagé (facultatif) |
| `PORT`, `HOST` | écoute (défaut `3000`, `127.0.0.1`) |
| `DATA_DIR` | données locales (défaut `.data`) |
| `WEB_DIST` | éditeur construit à servir (défaut `../web/dist`) |
| `ROLE` | `all` (défaut : API + rendu dans le même processus), `api`, ou `worker` (rendu seul ; demande PostgreSQL et un `RENDERS_DIR` partagé) |
| `RENDERS_DIR` | dossier des vidéos (défaut `DATA_DIR/renders`) |
| `VOICES_DIR` | répliques enregistrées, une par texte et par voix (défaut `DATA_DIR/voices`) |
| `RENDER_THREADS` | threads par rendu (défaut : nombre de cœurs − 1) |
| `FONTS_DIR` | polices du rendu serveur (défaut : celles de l'éditeur) |
| `FFMPEG_PATH`, `FFPROBE_PATH` | binaires FFmpeg (défaut : ceux du `PATH`) |

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
| `apps/api` | Fastify : projets versionnés, clés chiffrées, fournisseurs, file et workers de rendu ; sert l'éditeur construit |
| `apps/web` | l'éditeur (Vite + React) |

Détails : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Feuille de route

1. **Fondations** (fait) : format, moteur, deux styles, éditeur avec aperçu, fournisseurs et clés, Docker.
2. **Rendu serveur** (fait) : file de tâches dans PostgreSQL, workers qui rendent par blocs en parallèle, MP4 (FFmpeg) avec sous-titres, progression en direct, liens signés.
3. **Narration et son** (fait) : voix par réplique avec le fournisseur choisi (durées mesurées → l'horloge se recale seule), musique et bruitages synthétisés, mixage −16 LUFS, son dans l'aperçu et dans le MP4.
4. **Génération par IA** (fait) : texte → storyboard relu → scènes validées (corrections guidées, scène de secours), retouche d'une scène dans l'éditeur, tokens affichés.
5. **Ensuite** : comptes et invitations, collaboration, modèles de projets, packs de styles supplémentaires.

## Crédits

Polices : Fredoka et Patrick Hand (SIL Open Font License), Permanent Marker (Apache 2.0), dans `apps/web/public/fonts`
avec leurs licences. Le projet d'exemple reprend l'ouverture du court métrage « Awa et Jumo : la quête du jumeau stratégique ».
