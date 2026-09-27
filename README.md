# animation-flow

Générer des animations à partir d'une interface web. Une animation est décrite dans un **format de données** (JSON
validé) : ce qui se passe à l'écran, pas la façon de le dessiner. Le même projet se prévisualise en direct dans
l'éditeur et se rend dans **plusieurs styles** (vectoriel plat, aquarelle…). Les modèles d'IA sont **au choix** :
chaque équipe enregistre ses propres clés d'API et choisit un modèle par tâche.

État : **étape 1** (fondations). Le rendu vidéo côté serveur, la narration et la génération par IA arrivent aux étapes
suivantes (voir [Feuille de route](#feuille-de-route)).

## Démarrer

Prérequis : Node 22+, pnpm 10 (`corepack enable`).

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
```

## Ce que fait l'étape 1

- **Projets** : créer (exemple « Awa et Jumo » ou projet vide), ouvrir, enregistrer. Chaque enregistrement crée une
  version ; deux personnes qui éditent en même temps ne s'écrasent pas (l'éditeur propose de recharger ou de garder la sienne).
- **Aperçu en direct** dans chaque style, lecture, déplacement dans le temps, sous-titres, frise des scènes et des répliques.
- **Édition** d'une scène ou de la distribution en JSON : chaque frappe valide est appliquée à l'aperçu, une erreur est
  expliquée avec son chemin (`scenes.0.elements.2.ref`) et n'atteint jamais le projet.
- **Contrôle par la bibliothèque** : décor, accessoire, pose ou expression inconnus sont signalés (et dessinés comme
  un repère « ? » au lieu de faire échouer l'image).
- **Sous-titres** `.srt` exportés depuis l'horloge des répliques.
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

## Vérifier

```bash
pnpm typecheck
pnpm test                                    # schéma, moteur, styles (rendu Node), fournisseurs, API (PGlite)
TEST_DATABASE_URL=postgres://… pnpm vitest run apps/api   # l'API sur un vrai PostgreSQL (base effacée !)
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
| `packages/providers` | catalogue des fournisseurs, test d'une clé, liste des modèles |
| `apps/api` | Fastify : projets versionnés, clés chiffrées, fournisseurs ; sert l'éditeur construit |
| `apps/web` | l'éditeur (Vite + React) |

Détails : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Feuille de route

1. **Fondations** (fait) : format, moteur, deux styles, éditeur avec aperçu, fournisseurs et clés, Docker.
2. **Rendu serveur** : file de tâches (BullMQ + Redis), workers qui rendent par blocs en parallèle, encodage MP4 (FFmpeg), progression en direct.
3. **Narration et son** : voix par réplique avec le fournisseur choisi (durées mesurées → l'horloge se recale seule), musique et bruitages, mixage −16 LUFS.
4. **Génération par IA** : texte → storyboard → format d'animation validé (réparation automatique des erreurs), puis retouches dans l'éditeur.
5. **Ensuite** : comptes et invitations, collaboration, modèles de projets, packs de styles supplémentaires.

## Crédits

Polices : Fredoka et Patrick Hand (SIL Open Font License), Permanent Marker (Apache 2.0), dans `apps/web/public/fonts`
avec leurs licences. Le projet d'exemple reprend l'ouverture du court métrage « Awa et Jumo : la quête du jumeau stratégique ».
