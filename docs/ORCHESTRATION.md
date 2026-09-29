# Orchestration des agents

Comment terminer animation-flow avec des agents Claude, en peu de sessions, sans perdre en qualité.

## Principe

Une relecture indépendante n'a pas besoin d'une session de plus : un **sous-agent** de Claude Code tourne dans un
contexte vide, sans rien du raisonnement de l'auteur. Chaque session de travail contient donc son propre relecteur.

- **54 prompts** de `NEXT_PROMPTS.md` regroupés en **29 sessions** (au lieu de 54 + 51 relectures = 105).
- Une session : `/lot <ID> [<ID>…]`. Les règles sont dans `CLAUDE.md`, lu automatiquement.
- Une session ne dépasse pas 3 lots : au-delà, le contexte se dégrade. Un commit par lot au moins, poussé avant le lot
  suivant ; l'humain peut lancer `/compact` entre deux lots (l'agent ne le peut pas lui-même).
- **Le déploiement est repoussé à la fin** (sessions 26 à 29). Jusqu'à la session 25, tout se développe et se vérifie en local
  (`pnpm`, Docker Compose local, Playwright, Stripe en mode test, fournisseurs bouchons).

## Avant la session 1

- `NEXT_PROMPTS.md`, `docs/FEUILLE_DE_ROUTE.md` et `docs/moteur/plan.html` sont versionnés : les agents s'y réfèrent
  et s'arrêtent si l'un manque. `docs/adr/` est créé par la première ADR. Le « préambule commun » de `NEXT_PROMPTS.md`
  n'est plus à coller : `CLAUDE.md` le remplace, `/lot` donne le prompt.
- Session sur le web (Claude Code dans le navigateur) : l'environnement impose sa branche `claude/…` ; le groupe de lots
  y est commité (un commit au moins par lot) et donne une PR. En local : une branche `lot/<ID>` et une PR par lot.
- Le conteneur d'une session sur le web est neuf : `pnpm install` d'abord. FFmpeg n'y est pas forcément : sans lui, les
  tests de rendu, de son, de voix et d'envoi de fichiers échouent ; l'installer (script de l'environnement) ou les signaler « non vérifiés ».

## Les rôles

| Rôle | Fichier | Modèle | Lecture / écriture |
|---|---|---|---|
| Session de travail (implémente et coordonne) | (la session) | Opus ou Sonnet, voir tableau | écrit |
| `architecte` : plan et ADR avant un lot critique | `.claude/agents/architecte.md` | Opus | docs/adr/ seulement |
| `implementeur` : sous-lot indépendant, en parallèle | `.claude/agents/implementeur.md` | Sonnet | écrit |
| `mecanique` : i18n, changelog, cases, lint | `.claude/agents/mecanique.md` | Haiku 4.5 | écrit |
| `relecteur` : relecture indépendante de chaque lot | `.claude/agents/relecteur.md` | Opus | lecture seule |
| `securite` : revue sécurité des lots marqués 🔒 | `.claude/agents/securite.md` | Opus | lecture seule |

Choisir le modèle de la session : `claude --model opus` ou `/model` (Opus si un lot du groupe est critique, Sonnet sinon).

## Les 29 sessions

🔒 = revue `securite` en plus du `relecteur`. ⏸ = arrêt obligatoire pour l'humain. **C** = cadrage `architecte` avant de coder.

### Développement (en local)

| # | Commande | Modèle | Notes |
|---|---|---|---|
| 1 | `/lot A1 A2` | Opus | A2 : 🔒 C. Après A1 : activer la protection de la branche principale (voir plus bas) |
| 2 | `/lot A3` | Sonnet | Journaux, métriques, erreurs. La pile de surveillance se teste en local |
| 3 | `/lot M0a M0b` | Opus | C. Empreintes des images enregistrées **avant** de commencer |
| 4 | `/lot M1a M1b` | Opus | M1b : C. Objectif : écarts −70 % entre premier jet et fin de boucle |
| 5 | `/lot M1c` | Sonnet | Tests dorés et déterminisme obligatoires |
| 6 | `/lot B1` | Opus | 🔒 C |
| 7 | `/lot B2 B3` | Opus | C. ⏸ comptes fournisseurs (B2), validation des prix (B3) |
| 8 | `/lot B4` | Opus | 🔒 C. Procédure contenus illicites : à relire par un humain |
| 9 | `/lot B5` | Sonnet | 🔒 Test qui parcourt toutes les tables |
| 10 | `/lot B6 B7` | Sonnet | ⏸ identité de l'éditeur. Textes juridiques : **avocat** avant l'ouverture |
| 11 | `/lot B8` | Sonnet | ⏸ compte Stripe. Tout en mode test ; la vraie carte est reportée à la session 28 |
| 12 | `/lot C1 C3` | Opus | 🔒 C. C3 : revue de sécurité complète et cahier des charges du pentest |
| 13 | `/lot D3` | Opus | 🔒 C. La rotation de clés se vérifie en local ; en préproduction, session 26 |
| 14 | `/lot D4 D5 D6` | Sonnet | D5 : l'extraction des textes va à `mecanique` |
| 15 | `/lot D7` | Sonnet | Les tests rejoués « sur la préproduction » se vérifient en local d'abord |
| 16 | `/lot M2a M2b M2c` | Opus | M2b : 🔒 (parseur de formules hostiles) C |
| 17 | `/lot M3a M3b M3c` | Opus | C |
| 18 | `/lot M3d M3e` | Opus | |
| 19 | `/lot M4a M4b` | Opus | C |
| 20 | `/lot M4c M4d` | Opus | C |
| 21 | `/lot M5a M5b M5c` | Opus | C. Compositeur : images dorées Node = Chromium |
| 22 | `/lot M5d M5e` | Opus | C |
| 23 | `/lot M5f M5g M5h` | Sonnet | |
| 24 | `/lot M6a M6b` | Opus | C |
| 25 | `/lot M6c M6d M6e` | Sonnet | |

### Bloc déploiement (à la fin)

| # | Commande | Modèle | Notes |
|---|---|---|---|
| 26 | `/lot A4 A5` | Sonnet | ⏸ hébergeur, domaine, accès SSH. C. Secrets : relecture 🔒. Remettre la CI en route (push, pull request ; compte GitHub débloqué). Ensuite, refaire en préproduction toutes les vérifications reportées (voir plus bas) |
| 27 | `/lot C2` | Sonnet | Tests de charge sur la préproduction, page d'état, runbooks. Bottlenecks difficiles : sous-agent `architecte` |
| 28 | `/lot C4` | Opus | ⏸ pentest externe fait, avocat passé, vraie carte Stripe remboursée, décision `SIGNUP=open` |
| 29 | `/lot D1 D2` | Opus | C. Après l'ouverture : stockage objet, CDN, workers qui s'ajustent, mises à jour sans coupure |

## Vérifications reportées au bloc déploiement

Certains « Fini quand » parlent de la préproduction. Ils sont vérifiés en local pendant le développement, puis
**refaits en préproduction à la session 26** (l'agent les liste dans son rapport, la session 28 les contrôle une à une) :

| Lot | Ce qui est reporté |
|---|---|
| A1 | la CI passe sur la branche (déclenchement sur push et pull request remis en place ; le job Docker, dont l'envoi de 12 Mo à travers nginx, qui passe déjà en local) |
| A2 | la CI bloque sur une vulnérabilité haute (`pnpm audit --prod`, vérifié en local par son code de sortie), Trivy et la SBOM dans le job Docker, Renovate (installation de l'application, fusion automatique des correctifs une fois la CI verte) |
| A3 | alerte déclenchée sur la vraie pile de surveillance |
| B6 | pages légales en ligne, liées partout, en HTTPS |
| B8 | parcours inscription → premier film → abonnement de bout en bout |
| B2 | génération complète avec les vrais fournisseurs et les vraies clés de la plateforme |
| D3 | rotation complète des clés, isolation de FFmpeg dans le conteneur des workers |
| D7 | tests de bout en bout après chaque déploiement, tests de migration sur copie anonymisée |
| C1 | anti-robots avec les vraies clés, e-mails avec le vrai SMTP |

## Ordre et parallélisme

Sessions 1 → 2, puis 3 → 5 (moteur 0 et 1) et 6 → 11 (étape B) peuvent tourner en parallèle dans deux `git worktree`,
sauf si elles touchent un fichier partagé, qui se modifie une session à la fois :
- `packages/schema/src/` (le format) ;
- `packages/ai/src/pipeline.ts` (la génération) ;
- `packages/styles/src/output.ts` (la composition des sorties) et `packages/styles/src/composite.ts` (le compositeur
  commun, créé par M0b, repris par M5c et M5d) ;
- `apps/api/src/db.ts` : les migrations sont numérotées par leur place dans `MIGRATIONS` ; deux branches qui en
  ajoutent une chacune donnent deux migrations au même numéro. La seconde à fusionner renumérote la sienne.

Les sessions 12 → 25 suivent. Le bloc 26 → 29 vient en dernier.
Pas de session 16 (moteur 2) avant que la 4 (mesures M1) soit verte.

**Conséquence à connaître** : l'ouverture au public (session 28) arrive après le moteur 2 à 6, alors que la feuille de
route la place avant. Si vous préférez ouvrir plus tôt, déplacez le bloc 26 → 29 après la session 15, sans autre changement.

## Portes de qualité (toutes obligatoires avant la PR)

1. `pnpm typecheck && pnpm test` (et l'API sur PostgreSQL avec `TEST_DATABASE_URL` si le SQL change)
2. `pnpm e2e` si l'interface ou l'API change, avec captures regardées ; `e2e:cluster` si l'édition en direct change
3. Moteur : images dorées, déterminisme (20 images, 1 morceau contre 4), benchmark (échec au-delà de +15 %).
   Ces gardes sont **créées par M0a (empreintes) et M0b (bancs)**, qui inscrivent leurs commandes dans `CLAUDE.md` ; avant, le déterminisme
   repose sur `packages/styles/test/render.test.ts` et `packages/render/test/render.test.ts`, plus des images fixes regardées
4. Verdict `APPROUVÉ` du `relecteur` (et de `securite` pour 🔒)
5. Rapport final avec preuves, recopiées dans la PR ; case cochée dans `NEXT_PROMPTS.md`

La CI GitHub (`.github/workflows/ci.yml`) est reportée au bloc déploiement (décision du propriétaire) : le workflow est
écrit mais ne se lance qu'à la main, et la session 26 le remet sur push et pull request. Jusque-là, ces portes locales
sont la seule preuve ; un « Fini quand » qui demande la CI va dans les vérifications reportées.

## Ce qui reste à l'humain

- Activer la **protection de `main`** après A1 : PR obligatoire, une relecture. Exiger la CI verte seulement quand
  Actions lance vraiment le workflow (sinon plus rien ne fusionne). C'est ce qui remplace le déploiement automatique
  comme filet de sécurité pendant tout le développement local.
- Relire les PR des lots sensibles : paiement (B3, B8), suppression de données (B5), auth (B1), sauvegardes et
  déploiement (A4, A5), modération (B4).
- Fournir : comptes fournisseurs d'IA (B2), prix (B3), identité de l'éditeur (B6), compte Stripe (B8), hébergeur et
  domaine (A4), prestataire de pentest (C3, session 12, pour le test lui-même en 28).
- Avocat : CGU, CGV, confidentialité. Test d'intrusion externe. Décision `SIGNUP=open`.

## Si un agent bloque

- Deux tours de relecture sans que le bloquant disparaisse : l'agent s'arrête, vous tranchez.
- Une session trop lourde (lenteur, oublis) : commit et push, nouvelle session, prompt « Reprendre une session
  interrompue » de `NEXT_PROMPTS.md`. La reprise ne s'appuie que sur le dépôt (commits, cases cochées, PR).
- Refus sur une tâche de sécurité défensive (A2, C3, D3, fichiers hostiles) : les modèles récents ont des garde-fous cyber ;
  voir le Cyber Verification Program d'Anthropic si le refus est injustifié.
