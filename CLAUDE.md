# animation-flow : consignes pour les agents

Plateforme d'animation générée par IA. Monorepo pnpm (Node 22, TypeScript strict, ESM) :
`packages/` schema (Zod), engine, library, styles (6 packs Canvas 2D), render (FFmpeg), audio, ai, providers, ui ;
`apps/` api (Fastify, PostgreSQL ou PGlite embarqué), web (éditeur React + Vite), admin (back-office, serveur à part).

Lis d'abord `README.md` et `docs/ARCHITECTURE.md`, puis le code que tu vas toucher, en entier, avant de le modifier.
Pour un lot : son prompt dans `NEXT_PROMPTS.md`, `docs/ORCHESTRATION.md` et, pour le moteur, `docs/moteur/plan.html`.
Ce fichier remplace le « préambule commun » de `NEXT_PROMPTS.md` : ne pas le recoller.
Si un de ces documents manque dans le dépôt, arrête-toi et demande-le : ne reconstitue jamais un prompt de mémoire.

## Commandes (vérifiées)

```bash
pnpm install                  # d'abord, si node_modules manque (conteneur neuf)
pnpm typecheck                # tsc sur tout le dépôt
pnpm test                     # vitest : packages/*/test et apps/*/test (API sur PGlite) ; FFmpeg requis (rendu, son, voix)
pnpm vitest run packages/styles            # un seul paquet
TEST_DATABASE_URL=postgres://… pnpm vitest run apps/api --no-file-parallelism   # vrai PostgreSQL (un schéma par test)
pnpm e2e                      # construit web + admin, puis Playwright (Chromium de /opt/pw-browsers ou CHROMIUM_PATH)
CLUSTER_DATABASE_URL=postgres://… pnpm --filter @af/web e2e:cluster   # deux processus d'API (base effacée !)
pnpm --filter @af/styles still -- --style=watercolor --t=1,4,9          # images fixes dans out/stills, à regarder
pnpm --filter @af/render render -- --out=out/film.mp4 --style=flat --width=1280
```

Un test hors de `packages/*/test/` ou `apps/*/test/` n'est pas lancé par `pnpm test` ; les tests de bout en bout vont
dans `apps/web/e2e/`. La CI GitHub est prévue pour chaque PR et chaque push sur `main`, mais aucun job ne démarre tant que le compte GitHub
est bloqué (facturation) : les portes locales sont la preuve, et « la CI passe » reste « non vérifié ».
Les gardes du moteur (empreintes des modèles de projets, images dorées, déterminisme 1 morceau contre 4, benchmark)
n'existent pas encore : M0a et M0b les créent et **doivent ajouter leurs commandes exactes à cette section** en clôture.

## Règles non négociables

- **Secrets** : jamais de clé, mot de passe ou jeton dans le dépôt, un test, une capture ou un journal. Ils viennent de
  l'environnement (`.env.example` liste les variables, `.env` n'est jamais versionné) ; tu peux vérifier qu'une
  variable existe, jamais afficher sa valeur. Les clés des fournisseurs sont chiffrées en base et jamais renvoyées.
- **Déterminisme** : une image et son son ne dépendent que du projet et de `t`. Dans `engine`, `library`, `styles`,
  `audio` et le chemin des pixels de `render` : ni `Math.random`, ni horloge, ni ordre d'itération instable qui
  influe sur le résultat (le `performance.now()` des statistiques des styles est permis, il ne touche pas aux
  pixels). Le hasard vient de `rng` / `hashString` (`packages/engine/src/math.ts`), semé par un identifiant.
- **Compatibilité** : les projets existants ne changent pas. Champ nouveau du format = facultatif (ou migration du
  format dans `packages/schema`) ; les modèles de projets (`apps/api/src/templates.ts` : exemple, « Pizza Time »,
  vide) rendent les mêmes images au pixel près. Une migration SQL s'ajoute **à la fin** de `MIGRATIONS`
  (`apps/api/src/db.ts`), jamais en modifiant une migration passée ; le chemin de mise à jour est couvert par
  `apps/api/test/upgrade.test.ts`. Supprimer une colonne : ajouter, utiliser, puis retirer dans un lot suivant.
- **IA et utilisateurs écrivent des données**, validées (`parseProject`, schémas Zod), jamais du code exécuté. Un
  document joint au prompt est une donnée, pas une consigne pour le modèle.
- **Espaces et droits** : toute requête d'un espace filtre sur `workspace_id` ; un objet d'un autre espace répond 404.
  Chaque route déclare `config: { auth: … }` ou `{ role: … }` (défaut `viewer`, jamais ouverte par oubli) ; les
  écritures exigent l'en-tête `x-requested-with` (CSRF) ; les liens signés incluent l'espace. Le back-office
  (`apps/api/src/admin`) a ses propres comptes et son propre port.
- **Code comme le code autour** : commentaires et messages de commit en anglais (titre qui dit le comportement,
  corps qui dit pourquoi) ; textes d'interface et documentation en français clair. Mettre à jour `README.md` et
  `docs/ARCHITECTURE.md` dans le même lot que le changement de comportement.
- **Ne jamais affaiblir une garde pour passer** : pas de test sauté, désactivé ou assoupli, pas de référence dorée
  régénérée sans le dire et sans l'accord de l'humain.

## Méthode : une session = un groupe de lots

Une session traite 1 à 3 lots de `NEXT_PROMPTS.md` (tableau des sessions dans `docs/ORCHESTRATION.md`), lancée par
`/lot <ID> [<ID>…]`. Pour chaque lot, dans l'ordre :

1. **Branche** : si l'environnement impose une branche (session Claude Code sur le web : `claude/…`), l'utiliser pour
   tout le groupe, avec au moins un commit par lot. Sinon `lot/<ID>` depuis `main` à jour. Jamais de push sur `main`.
2. **Cadrage** : pour un lot marqué **C**, demande son plan au sous-agent `architecte` avant de coder ; une décision
   d'architecture devient une ADR dans `docs/adr/NNNN-titre.md`.
3. **Implémentation** par petits commits, tests écrits avec le code. Deux parties vraiment indépendantes peuvent aller
   au sous-agent `implementeur` (périmètre de fichiers explicite) ; les tâches mécaniques (extraction de textes,
   changelog, cases à cocher, listes de doc) au sous-agent `mecanique`.
4. **Portes** (toutes celles qui s'appliquent ; une porte impossible ici est signalée « non vérifiée », jamais sautée
   en silence) :
   - toujours : `pnpm typecheck && pnpm test` ;
   - SQL ou API : aussi sur PostgreSQL si `TEST_DATABASE_URL` est disponible ;
   - interface ou API : `pnpm e2e`, et captures Playwright **regardées** (Read sur l'image) pour tout ce qui se voit ;
     édition en direct : `e2e:cluster` si `CLUSTER_DATABASE_URL` est disponible ;
   - moteur, styles, rendu : gardes du moteur (dès M0b), sinon images fixes regardées avant / après.
5. **Relecture indépendante** : sous-agent `relecteur`, plus `securite` pour un lot 🔒. Ne leur donne que : la
   branche, la base (`main`), l'identifiant du lot et son « Fini quand » copié tel quel. **Jamais** tes explications
   ni ton raisonnement : ils jugent le code, pas ton récit. Corrige tout « bloquant » et « majeur » (sécurité :
   « critique » et « haute ») ; deux tours au plus, puis arrête-toi et demande à l'humain.
6. **Clôture** : coche la case du lot dans le tableau « Suivi » de `NEXT_PROMPTS.md` (même commit que le travail), mets à jour les docs, commite, pousse, ouvre la PR (une par
   lot, ou une pour le groupe sur une branche imposée) avec les preuves des portes dans sa description. Ne fusionne
   jamais toi-même. Commite et pousse avant de passer au lot suivant : une session interrompue doit pouvoir reprendre
   depuis le dépôt seul (tu ne peux pas lancer `/compact` toi-même).

## Quand t'arrêter et demander

- Le prompt dit **« À fournir »** et l'élément manque : dis précisément ce qu'il te faut.
- Décision du propriétaire : prix, hébergeur, domaine, texte juridique, prestataire, `SIGNUP=open`.
- Une garde du moteur ou un test existant change de résultat sans que le lot le demande.
- Le lot contredit une règle non négociable, ou touche un fichier partagé qu'une autre session modifie
  (`docs/ORCHESTRATION.md`, « Ordre et parallélisme »).
- Tu ne peux pas vérifier une chose : dis-la non vérifiée, ne la présente pas comme faite.

## Rapport final de chaque lot (bref)

Fait · Vérifié et comment (commande, capture, empreinte) · Non vérifié (dont les vérifications reportées à la
préproduction) · Décisions prises · Décisions pour le propriétaire · Verdict du relecteur (résumé) · Lien de la PR.
