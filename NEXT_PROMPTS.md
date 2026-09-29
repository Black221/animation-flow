# Prochains prompts : terminer animation-flow

Ce fichier contient les prompts à donner, un par session de travail (Claude Code ou un développeur), pour terminer la
plateforme :

- la rendre stable, déployée et ouverte au public ([docs/FEUILLE_DE_ROUTE.md](docs/FEUILLE_DE_ROUTE.md)) ;
- compléter le moteur d'animation ([docs/moteur/plan.html](docs/moteur/plan.html)).

**Mode d'emploi**

1. Ouvrir une nouvelle session sur ce dépôt.
2. Coller le **préambule commun**, puis **un** prompt de la liste. Un prompt correspond à une session d'un à trois jours.
3. À la fin, cocher la case du prompt dans le tableau ci-dessous (dans le même commit que le travail).

Les numéros entre crochets renvoient aux documents :

- `[FR 2.1]` : tâche 2.1 de la feuille de route ;
- `[M 3.4]` : lot 3.4 du plan du moteur.

Quelques prompts demandent une décision ou un compte que seul le propriétaire du projet peut fournir (hébergeur, nom de
domaine, avocat, Stripe). Ils sont marqués **« À fournir »** : réunir ces éléments avant de lancer la session.

**Ordre conseillé**

1. Étape A (A1 → A5).
2. Moteur phases 0 et 1 (M0a → M1c).
3. Étape B (B1 → B8).
4. Étape C (C1 → C4) : **ouverture publique**.
5. Ensuite, l'étape D et les phases 2 à 6 du moteur, en alternance, selon les priorités du moment.

---

## Suivi

| Prompt | Sujet | Fait |
|---|---|---|
| A1 | Correctifs rapides et intégration continue | [ ] |
| A2 | Sécurité express : SSRF, en-têtes, audit des dépendances | [ ] |
| A3 | Surveillance : journaux, métriques, erreurs, alertes | [ ] |
| A4 | Déploiement : environnements, HTTPS, secrets, mise en production | [ ] |
| A5 | Sauvegardes et restauration | [ ] |
| M0a | Moteur 0 : format v2, migration, pistes de valeurs | [ ] |
| M0b | Moteur 0 : arbre de composition, métriques de texte, tests dorés | [ ] |
| M1a | Moteur 1 : measure.ts et contraste | [ ] |
| M1b | Moteur 1 : relecture du mouvement, correctifs ciblés, rapport | [ ] |
| M1c | Moteur 1 : flou de mouvement, 50 et 60 i/s | [ ] |
| B1 | Limites de débit et double authentification des gérants | [ ] |
| B2 | Modèles fournis par la plateforme et mesure des coûts | [ ] |
| B3 | Plans calibrés sur les coûts, crédits | [ ] |
| B4 | Modération des entrées et des sorties de l'IA | [ ] |
| B5 | RGPD technique : suppression, export, conservation | [ ] |
| B6 | Pages légales, transparence IA, site public | [ ] |
| B7 | Modération DSA, droit d'auteur, règles de la communauté | [ ] |
| B8 | Accueil, support, Stripe en production, TVA | [ ] |
| C1 | Vérification de l'e-mail et anti-robots | [ ] |
| C2 | Tests de charge, résilience des fournisseurs, page d'état, runbooks | [ ] |
| C3 | Préparation du test d'intrusion | [ ] |
| C4 | Revue du jour d'ouverture | [ ] |
| D1 | Stockage objet et CDN | [ ] |
| D2 | Workers qui s'ajustent, rendus qui reprennent, mises à jour sans coupure | [ ] |
| D3 | Rotation des clés, isolation de FFmpeg, sessions, 2FA des utilisateurs | [ ] |
| D4 | Accessibilité | [ ] |
| D5 | Interface en anglais | [ ] |
| D6 | Aide, e-mails, performances, erreurs, mesure d'audience | [ ] |
| D7 | Facturation, drapeaux, tests de préproduction, modèles de projets | [ ] |
| M2a | Moteur 2 : Bézier, trajectoires, ressorts | [ ] |
| M2b | Moteur 2 : fondus de poses, couches, formules, temps | [ ] |
| M2c | Moteur 2 : éditeur de courbes et trajectoires | [ ] |
| M3a | Moteur 3 : rig standard et bibliothèque d'actions | [ ] |
| M3b | Moteur 3 : parentage, IK, locomotion | [ ] |
| M3c | Moteur 3 : mouvement secondaire et déformation | [ ] |
| M3d | Moteur 3 : vues, humeurs, visèmes, foules | [ ] |
| M3e | Moteur 3 : côté IA et éditeur | [ ] |
| M4a | Moteur 4 : brief-contrat, voix d'abord, validation des fiches | [ ] |
| M4b | Moteur 4 : scène modèle, guide chiffré, exemples | [ ] |
| M4c | Moteur 4 : intentions compilées en clés | [ ] |
| M4d | Moteur 4 : le modèle interroge le moteur | [ ] |
| M5a | Moteur 5 : calques de formes, opérateurs, morphing | [ ] |
| M5b | Moteur 5 : typographie animée | [ ] |
| M5c | Moteur 5 : masques, fusion, effets | [ ] |
| M5d | Moteur 5 : compositions imbriquées et transitions | [ ] |
| M5e | Moteur 5 : 2,5D et caméra | [ ] |
| M5f | Moteur 5 : gabarits, variables, charte, formats | [ ] |
| M5g | Moteur 5 : données et musique | [ ] |
| M5h | Moteur 5 : côté IA et éditeur | [ ] |
| M6a | Moteur 6 : particules et cordes | [ ] |
| M6b | Moteur 6 : rendu GPU | [ ] |
| M6c | Moteur 6 : exports Lottie, transparence, pistes | [ ] |
| M6d | Moteur 6 : plusieurs langues | [ ] |
| M6e | Moteur 6 : performance | [ ] |

---

## Préambule commun (à coller en tête de chaque session)

```text
Tu travailles sur animation-flow (dépôt Black221/animation-flow) : une plateforme d'animation générée par IA.
C'est un monorepo pnpm en TypeScript :
- packages/schema (format Zod), engine, library, styles (6 styles Canvas 2D), render (FFmpeg), audio, ai, providers, ui ;
- apps/api (Fastify, PostgreSQL ou PGlite) ;
- apps/web (éditeur React) ;
- apps/admin (back-office).

Lis d'abord : README.md, docs/ARCHITECTURE.md, docs/FEUILLE_DE_ROUTE.md et, pour le moteur, docs/moteur/plan.html.
Puis lis le code que tu vas toucher avant de le modifier.

Règles non négociables :
- Ne jamais écrire une clé, un mot de passe ou un jeton dans un fichier du dépôt ni dans les journaux. Les secrets
  viennent de l'environnement ; tu peux seulement vérifier qu'une variable existe, jamais afficher sa valeur.
  Aucun fichier .env dans le dépôt : vérifie le .gitignore.
- Moteur : une image ne dépend que du projet et de t. Pas de Math.random, pas d'horloge ; le hasard est semé.
- Les projets existants ne changent pas : champs nouveaux facultatifs, migration du format, mêmes images au pixel
  près sur les modèles de projets.
- Le modèle d'IA et l'utilisateur écrivent des données validées, jamais du code exécuté.
- Écris le code comme le code autour (commentaires en anglais, textes de l'interface en français clair).
  Mets à jour README et ARCHITECTURE quand le comportement change.

Avant chaque commit :
- lance pnpm typecheck && pnpm test ;
- lance pnpm e2e si l'interface ou l'API change ;
- pour tout ce qui se voit, fais des captures (Playwright, Chromium) et regarde-les.

Commit avec un message clair, puis pousse sur la branche de la session.

À la fin, coche la ligne du prompt dans NEXT_PROMPTS.md et donne un rapport bref : ce qui est fait, ce qui est
vérifié (et comment), ce qui ne l'est pas, les décisions que tu as prises et celles qui restent au propriétaire.
```

---

## Étape A : déployable

### A1 · Correctifs rapides et intégration continue

```text
Tâches de docs/FEUILLE_DE_ROUTE.md : [FR 1.1] [FR 1.2] [FR 3.10] [FR 3.11] [FR 10.2].

1. deploy/nginx.conf :
   - client_max_body_size à 64m pour /api/uploads/ (garder 10m ailleurs) ;
   - corriger le commentaire qui parle de 8 Mo ;
   - timeouts adaptés aux envois de fichiers.
   Ajoute un test ou une vérification dans le job docker de la CI : envoi d'une image de 12 Mo à travers nginx.
2. .github/workflows/ci.yml : déclencher sur push et pull_request (garder workflow_dispatch).
   Mettre en cache le navigateur de Playwright. Ajouter pnpm audit --prod (niveau high) comme étape non bloquante
   pour l'instant.
3. /api/ready :
   - vérifie la base (SELECT 1), l'écriture dans DATA_DIR et la présence de FFmpeg ;
   - répond 503 sinon ;
   - utilisé par les healthchecks Docker et nginx à la place de /api/health (qui reste la sonde de vie).
4. Versions : CHANGELOG.md (format Keep a Changelog), version 0.9.0 dans les package.json. La version et le commit
   sont exposés par /api/health et affichés dans le pied du back-office.

Fini quand : la CI passe sur la branche ; le test des 12 Mo passe à travers nginx ; /api/ready répond 503 quand la
base est coupée (test d'API).
```

### A2 · Sécurité express : SSRF, en-têtes, audit

```text
Tâches : [FR 2.1] [FR 2.2] [FR 2.9].

1. SSRF. Les adresses de fournisseurs (baseUrl des clés « compatible OpenAI », et tout appel sortant vers une adresse
   donnée par un utilisateur) ne doivent pas viser le réseau interne.
   - Crée apps/api/src/net/safe-fetch.ts :
     - résolution DNS, puis refus des plages privées, locales et de lien local (IPv4 et IPv6), ainsi que des noms
       de métadonnées cloud ;
     - vérification refaite à chaque redirection (5 au plus) ;
     - connexion à l'adresse vérifiée (pas de seconde résolution : protection contre le DNS rebinding) ;
     - délai maximum et taille maximum de la réponse.
   - Utilise-le pour tous les appels aux fournisseurs (packages/providers reçoit ce fetch).
   - Variable ALLOW_PRIVATE_PROVIDERS=true pour un serveur privé (Ollama local), désactivée par défaut, documentée
     dans le README.
   - Tests : 127.0.0.1, 10.x, 169.254.169.254, [::1], un nom qui résout vers une adresse privée, une redirection
     vers une adresse privée. Tous refusés. Une adresse publique acceptée.
2. En-têtes de l'application (le back-office les a déjà : réutilise sa logique) :
   - Content-Security-Policy stricte (default-src 'self', scripts et styles du site, img/media blob: data: et nos
     liens signés, connect-src 'self' plus WebSocket, frame-ancestors 'none', base-uri 'none', form-action 'self') ;
   - Strict-Transport-Security (quand HTTPS), X-Content-Type-Options, Referrer-Policy, Permissions-Policy.
   Vérifie dans les tests de bout en bout qu'aucune erreur CSP n'apparaît dans la console (éditeur, rendu, IA,
   communauté, lecture vidéo).
3. Audit :
   - pnpm audit bloquant en CI pour high et critical ;
   - configuration Renovate (regroupement hebdomadaire, fusion automatique des correctifs de patch une fois la CI
     verte) ;
   - analyse de l'image Docker avec Trivy dans la CI ;
   - SBOM CycloneDX en artefact.

Fini quand : les tests SSRF passent, la CI bloque sur une vulnérabilité haute, aucune erreur CSP en e2e.
```

### A3 · Surveillance

```text
Tâches : [FR 4.1] [FR 4.2] [FR 4.3] [FR 4.4].

1. Journaux :
   - JSON (logger pino de Fastify), un identifiant par requête (en-tête x-request-id propagé jusqu'aux workers de
     rendu et aux appels d'IA) ;
   - masquage des champs sensibles : écris un test qui vérifie qu'aucune clé API, aucun mot de passe, cookie ou
     jeton n'apparaît dans les journaux d'un parcours complet (inscription, clé, génération, paiement de test).
2. Métriques Prometheus sur /metrics, sur un port interne (METRICS_PORT, désactivé par défaut) :
   - requêtes par route, statut et durée ;
   - connexions en direct ;
   - file de rendu (en attente, en cours, durée, échecs) ;
   - générations par étape ;
   - appels d'IA par fournisseur et modèle (durée, erreurs, jetons) ;
   - e-mails envoyés ou en échec ;
   - webhooks Stripe.
   Utilise prom-client.
3. Erreurs : Sentry compatible (SENTRY_DSN, facultatif, hébergeable en UE avec GlitchTip), serveur et navigateur.
   Données personnelles retirées (e-mails, textes des brefs), taux d'échantillonnage réglable.
4. Alertes :
   - deploy/monitoring/ avec un docker-compose facultatif (Prometheus, Alertmanager, Grafana, Loki) et des règles
     d'alerte : service injoignable, erreurs 5xx supérieures à 2 % sur 5 min, file de rendu bloquée plus de 15 min,
     disque à plus de 85 %, sauvegarde manquée, certificat à moins de 14 jours, webhook Stripe en échec, coût d'IA
     horaire anormal ;
   - un tableau Grafana exporté en JSON.
   Documente dans le README.

Fini quand : /metrics expose ces séries (test d'API), le test anti-fuite des journaux passe, la stack de surveillance
démarre en local avec une alerte déclenchée à la main.
```

### A4 · Déploiement

```text
À fournir : l'hébergeur choisi (UE : OVHcloud, Scaleway, Hetzner…), le nom de domaine, un accès SSH à la machine de
préproduction. Ne jamais mettre ces accès dans le dépôt : ils vont dans les secrets de GitHub ou de l'hébergeur.

Tâches : [FR 3.1] [FR 3.2] [FR 3.3] [FR 3.7].

1. deploy/production/ :
   - docker-compose.prod.yml : Caddy (HTTPS automatique Let's Encrypt, redirection HTTP → HTTPS, WebSocket,
     tailles d'envoi, compression), application, workers, PostgreSQL (ou base gérée par DATABASE_URL) ;
   - TRUST_PROXY réglé sur Caddy, COOKIE_SECURE=true, APP_URL.
2. Environnements :
   - fichiers d'exemple deploy/production/{staging,production}.env.example (noms de variables seulement, jamais de
     valeur) ;
   - une procédure pour mettre les vraies valeurs dans un coffre (secrets GitHub Environments, ou SOPS avec age) ;
   - vérification au démarrage : l'application refuse de démarrer en production sans APP_ENCRYPTION_KEY, APP_URL
     en https, COOKIE_SECURE.
3. .github/workflows/deploy.yml :
   - construction et publication de l'image (GHCR, étiquetée par commit et par version) ;
   - déploiement automatique en préproduction à chaque fusion sur la branche principale ;
   - déploiement en production sur étiquette v*.*.*, avec approbation manuelle (environnement protégé) ;
   - migrations appliquées avant le basculement ;
   - vérification /api/ready ;
   - retour automatique à l'image précédente si la vérification échoue.
4. docs/DEPLOIEMENT.md : de zéro à la préproduction, pas à pas ; mise à jour ; retour arrière ; ajout d'un worker.

Fini quand : la préproduction répond en HTTPS sur le domaine, un commit fusionné s'y déploie seul, et un retour
arrière a été essayé.
```

### A5 · Sauvegardes et restauration

```text
Tâches : [FR 3.4] [FR 3.5] [FR 3.6, partie P0].

1. PostgreSQL :
   - sauvegarde continue (WAL-G ou pgBackRest) vers un stockage objet d'une autre région, chiffrée, conservée
     30 jours, avec retour à un instant précis ;
   - si la base est gérée par l'hébergeur, documente et vérifie ses réglages à la place.
2. Médias (DATA_DIR : vidéos, voix, images, communauté) : restic vers le stockage objet, toutes les 6 heures,
   rétention 7 jours, 4 semaines et 6 mois.
3. scripts/restore-drill.sh :
   - restaure la dernière sauvegarde dans un environnement vide ;
   - lance l'application ;
   - vérifie qu'un projet s'ouvre, qu'une clé chiffrée se déchiffre et qu'une vidéo se lit ;
   - écrit un rapport.
   Planifié chaque mois dans GitHub Actions (sur la préproduction).
4. Alerte « sauvegarde manquée » branchée (A3).
5. docs/runbooks/restauration.md.

Fini quand : une restauration complète a été faite et chronométrée ; le temps et la perte possible sont écrits
dans le runbook.
```

---

## Moteur, phases 0 et 1 (avant la bêta ouverte)

### M0a · Format v2, migration, pistes de valeurs

```text
Lis docs/moteur/plan.html, phase 0. Lots [M 0.1] [M 0.2].

1. packages/schema :
   - SCHEMA_VERSION 2 et migrateProject(v1) → v2, appliquée à la lecture (API), à l'import et dans la génération ;
   - aucun champ nouveau obligatoire.
2. packages/engine :
   - nouveau tracks.ts : les clés d'un élément deviennent une piste par propriété, précalculée une fois par scène
     (temps résolus) ;
   - échantillonnage par recherche dichotomique ;
   - l'API publique de l'évaluateur ne change pas.
3. Test de garde :
   - les images des modèles de projets (blank, example, pizza) et du projet de la campagne JOJ (apps/api/out/joj,
     s'il est là) sont identiques au pixel près avant et après ;
   - enregistre les empreintes avant de commencer.

Fini quand : pnpm test vert ; empreintes identiques ; mesure de performance (ms par image sur example)
au moins aussi bonne qu'avant.
```

### M0b · Arbre de composition, métriques de texte, tests dorés

```text
Lots [M 0.3] [M 0.4] [M 0.5].

1. Primitive group (children, opacity, blend, mask, effects), et packages/styles/src/composite.ts : un compositeur
   commun aux 6 styles, qui ne passe par un canevas hors écran que si c'est nécessaire, avec une réserve de
   canevas. Sans group, rien ne change.
2. Métriques des 4 polices livrées :
   - extraites au build (opentype.js) dans fonts-metrics.json ;
   - nouveau engine/src/text-layout.ts (avances, crénage, retour à la ligne) ;
   - la mise en page du texte devient identique dans Node et dans le navigateur.
   Vérifie que les boîtes de texte sont les mêmes des deux côtés.
3. Bancs de test :
   - images dorées par style (tolérance : 1 % de pixels, écart moyen ≤ 2/255), dans Node et dans Chromium ;
   - déterminisme : 20 images de même empreinte en 1 et en 4 morceaux ;
   - bench/ : ms par image sur le banc d'essai, suivi en CI (échec au-delà de +15 %).

Fini quand : les trois bancs tournent en CI et passent ; aucune image changée sur les modèles de projets.
```

### M1a · measure.ts et contraste

```text
Lots [M 1.1] [M 1.2], critères de la section « Ce que réussi veut dire » de docs/moteur/moteur.html.

Crée packages/engine/src/measure.ts : measureScene(project, sceneIndex) → Issue[], avec chemin, image, gravité et
conseil. Critères :
- à-coups (> 60 px ou 0,7 rad par image, échantillonnage à 24 i/s) ;
- bande des sous-titres occupée par un visage ou un texte ;
- temps de lecture des textes (≥ 0,3 s + 1 s par 15 caractères) ;
- personnage qui parle hors cadre ou caché ;
- textes qui se chevauchent ;
- plan immobile plus de 4 s ;
- plus de 2 mouvements majeurs simultanés ;
- flashs (au plus 3 par seconde).

Contraste :
- rendu en style plat (packages/render), couleur du fond échantillonnée sous chaque texte ;
- rapport WCAG ≥ 4,5:1, ou 3:1 au-delà de 48 px.

Tests avec des scènes construites pour violer chaque critère, et une scène propre sans aucun écart.
Lance les mesures sur les films générés existants (campagne JOJ, Pizza Time) et joins le résultat au rapport.

Fini quand : chaque critère a un test positif et un test négatif.
```

### M1b · Relecture du mouvement, correctifs ciblés, rapport

```text
Lots [M 1.3] [M 1.4] [M 1.5] [M 1.6].

1. Planches : 8 à 12 images d'une scène avec leurs temps, un ruban du geste principal, un gros plan du visage de
   celui qui parle. Images d'au plus 1024 px (packages/ai/src/preview.ts, packages/render).
2. Nouvelle étape motion dans la génération (packages/ai/src/pipeline.ts) :
   - le modèle qui voit reçoit les planches, les mesures et la liste de contrôle du guide ;
   - il répond { ok, problems, patch }, avec patch un sous-ensemble de JSON Patch limité aux clés et paramètres de
     la scène (nouveau patch.ts, avec validation) ;
   - 3 tours au plus ; arrêt quand les mesures passent et que la relecture dit bon ;
   - sans modèle qui voit, les mesures seules.
3. Rapport :
   - generation.report (critères contrôlés avec valeur, seuil et statut ; non contrôlés ; défauts connus) ;
   - affiché sur la page de la génération (apps/web/src/pages/Generate.tsx) et gardé avec le projet.
4. Panneau des mesures dans l'éditeur : écarts de la scène, un clic amène à l'image et sélectionne l'élément,
   recalcul à la sauvegarde.

Tests avec le modèle bouchon (comme apps/api/test/references.test.ts) : un premier jet avec un à-coup, un correctif
qui le supprime, puis un rapport vert. Un test de bout en bout pour le panneau.

Fini quand : sur le banc d'essai (au moins 3 films), les écarts baissent d'au moins 70 % entre le premier jet et la
fin de la boucle.
```

### M1c · Flou de mouvement, 50 et 60 i/s

```text
Lot [M 1.7].

- Flou de mouvement :
  - obturateur de 180° par défaut, réglable par élément et au rendu ;
  - 3 à 8 sous-instants selon la vitesse maximale dans l'image (aucun si rien ne bouge de plus de 8 px par image) ;
  - accumulation dans un tampon Float32 (pas de bandes) ;
  - dans packages/styles/src/output.ts et le rendu serveur ;
  - option dans le panneau de rendu.
- fps : ajouter 50 et 60 au schéma ; rendu, sous-titres et mixage suivent.

Tests :
- une image fixe rendue avec et sans flou est identique ;
- un objet rapide s'étale le long de sa trajectoire ;
- le coût est mesuré et noté dans le rapport.

Fini quand : le rendu 60 i/s et le flou passent les tests dorés et de déterminisme.
```

---

## Étape B : bêta privée sur invitation

### B1 · Limites de débit et double authentification des gérants

```text
Tâches : [FR 2.5] [FR 2.6, gérants].

1. Limites de débit générales :
   - par utilisateur et par adresse IP, sur toutes les écritures, et plus serrées sur la génération, l'IA, les
     envois de fichiers, les rendus, la publication et les signalements ;
   - compteurs dans PostgreSQL (fenêtre glissante), pour valoir sur toutes les instances ;
   - réponse 429 avec Retry-After ;
   - réglages dans un seul fichier (apps/api/src/limits.ts) ;
   - tests multi-instances (le test de cluster existe).
2. TOTP obligatoire pour les gérants du back-office :
   - mise en place avec un QR code ;
   - 10 codes de secours hachés ;
   - réinitialisation par un autre gérant, inscrite au journal d'audit ;
   - secret TOTP chiffré avec la SecretBox.
   Puis clés d'accès WebAuthn en option.

Fini quand : un gérant sans TOTP ne peut rien faire après sa connexion ; les limites sont testées ; e2e du
back-office à jour.
```

### B2 · Modèles fournis par la plateforme et mesure des coûts

```text
À fournir : les comptes de la plateforme chez les fournisseurs retenus (texte, voix, images). Les clés sont mises
par le propriétaire dans les secrets : jamais dans le dépôt.

Tâches : [FR 6.1] [FR 6.2].

1. « Clés de la plateforme » :
   - des identifiants gérés dans le back-office (chiffrés, comme ceux des espaces) ;
   - des affectations par défaut pour chaque tâche (storyboard, scènes, dessins, musique, voix, images) ;
   - un espace sans clé propre utilise celles de la plateforme ; « mes propres clés » reste possible et prioritaire.
2. Coût de chaque appel :
   - table des prix par modèle (packages/providers, mise à jour facile), calcul en micro-euros (jetons d'entrée et
     de sortie, secondes de voix, images) ;
   - enregistrement dans usage_events avec le coût réel quand la plateforme paie ;
   - affichage du coût par génération dans le back-office.
3. Plafonds : par espace (jour, mois), par génération et global de la plateforme (coupe-circuit). Message clair à
   l'utilisateur quand un plafond est atteint.

Tests avec des fournisseurs bouchons : une génération complète sans clé propre, coût enregistré, plafond qui arrête
la génération proprement (étape en cours terminée, pas de suivante).

Fini quand : un nouvel utilisateur génère un film sans rien configurer.
```

### B3 · Plans calibrés sur les coûts, crédits

```text
À fournir : les prix voulus (ou valide la proposition chiffrée que tu feras d'abord).

Tâche : [FR 6.3].

1. À partir des coûts mesurés (B2) sur le banc d'essai, propose un crédit mensuel d'IA par plan (Gratuit, Premium,
   Pro) et une marge, dans un tableau. Attends la validation avant de coder les montants.
2. Crédits :
   - solde par espace, décompté à chaque appel payé par la plateforme ;
   - jauge dans l'interface (le composant de jauge existe) ;
   - achat de crédits supplémentaires par Stripe (paiement unique) ;
   - arrêt propre à zéro ;
   - e-mail à 80 % et à 100 %.
3. Le back-office montre le solde, la consommation et le coût réel par espace.

Fini quand : parcours complet en e2e avec Stripe en mode test.
```

### B4 · Modération des entrées et des sorties de l'IA

```text
Tâches : [FR 6.5] [FR 6.6] [FR 8.2].

1. Brief et textes : un appel de modération (API de modération d'un fournisseur, ou un modèle avec une consigne
   dédiée) avant le storyboard. Refus motivé ou envoi à la file de modération selon la gravité.
2. Images jointes et images rendues publiées :
   - détection des contenus pédocriminels par empreintes connues (service spécialisé : Thorn Safer, ou Microsoft
     PhotoDNA via l'organisme habilité) ;
   - classification nudité et violence pour la publication ;
   - un fichier détecté est bloqué, conservé pour les autorités selon la loi, et signalé.
   Documente la procédure dans docs/runbooks/contenus-illicites.md.
3. À la publication, contrôles automatiques (titre, description, images du film, transcription) : les cas douteux
   vont dans la file du back-office.
4. Conservation des consignes et réponses des modèles (journal des étapes) :
   - 30 jours, puis on ne garde que les métadonnées (jetons, durée, statut) ;
   - option « zéro rétention » chez les fournisseurs quand elle existe ;
   - écrit dans la politique de confidentialité (B6).

Fini quand : tests avec des bouchons pour chaque décision (autoriser, refuser, envoyer à la modération) ; tâche de
purge testée.
```

### B5 · RGPD technique : suppression, export, conservation

```text
Tâches : [FR 5.5] [FR 5.6] [FR 5.7] [FR 1.3].

1. Supprimer son compte (Profil → Supprimer mon compte), confirmé par le mot de passe :
   - les espaces dont on est seul propriétaire sont supprimés (avec confirmation de la liste) ou transférés à un
     administrateur ;
   - les commentaires sont anonymisés (« compte supprimé ») ;
   - les publications sont retirées ou gardées anonymes, selon le choix proposé ;
   - l'abonnement Stripe est résilié ;
   - suppression effective sous 30 jours (période pendant laquelle on peut annuler), puis purge des fichiers.
2. Exporter mes données : une archive (JSON du compte, projets au format d'export existant, commentaires,
   factures), prête par e-mail avec un lien signé valable 7 jours.
3. Tâches planifiées de conservation (un seul module, apps/api/src/retention.ts, lancé chaque heure) :
   - sessions expirées ;
   - liens de réinitialisation et d'invitation expirés ;
   - comptes non confirmés (7 jours) ;
   - comptes supprimés (30 jours) ;
   - rendus au-delà de la durée du plan ;
   - journaux d'étapes d'IA (30 jours) ;
   - audit (1 an).
4. [FR 1.3] : « Toutes les répliques ont leur voix » ne s'affiche qu'une fois le projet enregistré avec toutes les
   voix. Test e2e.

Fini quand : chaque suppression et chaque purge est testée, et aucune donnée de l'utilisateur ne reste en base après
la purge (test qui parcourt toutes les tables).
```

### B6 · Pages légales, transparence IA, site public

```text
À fournir : l'identité de l'éditeur (raison sociale, adresse, SIRET, directeur de la publication), l'hébergeur,
l'adresse de contact. Les textes que tu rédiges sont des projets : ils doivent être relus par un avocat avant
l'ouverture. Dis-le en tête de chaque page tant que ce n'est pas fait.

Tâches : [FR 5.1] [FR 5.2] [FR 5.3] [FR 5.4] [FR 5.8] [FR 5.9] [FR 5.10] [FR 5.13] [FR 7.2, pages].

1. Pages dans apps/web :
   - mentions légales, CGU, CGV, politique de confidentialité, cookies (le cookie de session seul, donc pas de
     bandeau), sous-traitants (liste tenue à jour) ;
   - liées depuis un pied de page présent partout et depuis l'inscription (case « j'accepte les CGU », version
     enregistrée) ;
   - textes en Markdown dans apps/web/src/legal/, versionnés ; une nouvelle version demande une nouvelle
     acceptation.
2. CGU : âge minimum 15 ans, contenus interdits, droits sur les fichiers joints comme modèles (mascottes, logos,
   voix), licence des publications, remix, clonage de voix interdit sans accord.
3. Transparence IA (AI Act, art. 50, en vigueur) :
   - mention « généré avec l'IA » sur la page d'un film publié ;
   - métadonnée dans les fichiers MP4 et WebM (ffmpeg -metadata) ;
   - manifeste C2PA si une bibliothèque sûre existe (sinon, noté pour plus tard).
4. docs/conformite/ :
   - registre des traitements (modèle rempli) ;
   - liste des accords de sous-traitance (DPA) à signer, avec leurs liens.
5. Site public : page d'accueil, tarifs (depuis les plans), exemples (films de la communauté mis en avant), FAQ.
   Cartes Open Graph pour les films publiés.

Fini quand : toutes les pages sont en ligne en préproduction, liées partout, et l'acceptation des CGU est
enregistrée et testée.
```

### B7 · Modération DSA, droit d'auteur, règles de la communauté

```text
Tâches : [FR 5.11] [FR 5.12] [FR 8.1] [FR 8.4] [FR 8.5].

1. Règles de la communauté (page publique), liées depuis la publication et le signalement.
2. Back-office :
   - chaque décision (masquer, retirer, suspendre) demande un motif choisi dans une liste, plus un texte ;
   - l'auteur reçoit l'exposé des motifs par e-mail et dans l'application, avec un bouton « Contester » ;
   - les contestations arrivent dans une file à part ;
   - historique par compte ;
   - actions en lot.
3. Formulaire de retrait pour atteinte au droit d'auteur (identité, œuvre, lien, déclaration sur l'honneur),
   traitement dans le back-office, réponse au demandeur et à l'auteur.
4. Point de contact unique (autorités et utilisateurs) indiqué dans les mentions légales.
5. docs/runbooks/moderation.md :
   - délais cibles (24 h ; 1 h pour les contenus graves) ;
   - astreinte ;
   - signalement PHAROS ;
   - conservation des preuves.
6. Données pour le rapport de transparence annuel (compteurs par motif et par délai) dans le back-office.

Fini quand : parcours signalement → décision motivée → contestation → décision finale en e2e.
```

### B8 · Accueil, support, Stripe en production, TVA

```text
À fournir : le compte Stripe en mode production (produits et prix créés), l'activation de Stripe Tax, l'adresse du
support. Les clés Stripe vont dans les secrets, jamais dans le dépôt.

Tâches : [FR 7.1] [FR 7.4] [FR 9.1] [FR 9.2] [FR 5.14] [FR 1.6].

1. Premier film guidé :
   - après l'inscription, 3 étapes : une idée (exemples cliquables), un style, générer ;
   - aucun réglage de fournisseur (grâce à B2) ;
   - un film d'exemple prêt à remixer.
   Mesure le temps jusqu'au premier film et vise moins de 5 minutes.
2. Support :
   - bouton « Signaler un problème » partout, qui joint le contexte technique (version, page, identifiant de
     requête, navigateur, jamais de contenu privé sans accord) ;
   - envoi à l'adresse du support.
3. Stripe production :
   - vérifie le webhook de production ;
   - tests réels (carte, échec, renouvellement, changement de plan, résiliation, remboursement), en préproduction
     avec les clés de test, puis une carte réelle remboursée en production ;
   - relances sur échec et période de grâce de 7 jours ;
   - factures accessibles.
   - TVA : Stripe Tax activé, numéro de TVA pour les entreprises, factures conformes.
4. [FR 1.6] Voix : vérifier que le modèle Fish Audio prévu répond en production (crédit API), avec une alerte sur le
   solde ou les 402.

Fini quand : le parcours inscription → premier film → abonnement fonctionne en préproduction de bout en bout.
```

---

## Étape C : bêta ouverte

### C1 · Vérification de l'e-mail et anti-robots

```text
Tâches : [FR 2.3] [FR 2.4].

1. Vérification de l'e-mail :
   - à l'inscription (SIGNUP=open), un lien à usage unique (24 h) ;
   - sans vérification : lecture seulement (pas de génération, pas de publication, pas d'invitation), et un
     bandeau qui propose de renvoyer le lien ;
   - changement d'adresse vérifié de la même façon.
2. Anti-robots : Cloudflare Turnstile (ou hCaptcha), sur l'inscription, le mot de passe oublié et le formulaire de
   droit d'auteur :
   - vérification côté serveur ;
   - clés dans l'environnement ;
   - désactivable pour un serveur privé ;
   - e2e avec la clé de test du fournisseur.

Fini quand : un compte non vérifié ne peut pas générer (test d'API) ; les e2e passent avec la clé de test.
```

### C2 · Tests de charge, résilience, page d'état, runbooks

```text
Tâches : [FR 4.5] [FR 4.6] [FR 4.7] [FR 4.8] [FR 4.9].

1. bench/load/ (k6) :
   - 500 utilisateurs qui ouvrent et font défiler l'éditeur ;
   - 50 éditions à plusieurs en direct ;
   - 20 rendus simultanés ;
   - 10 générations avec un modèle bouchon.
   Lance-les sur la préproduction, mesure, corrige les goulots (requêtes lentes, index manquants, verrous),
   recommence. Rapport chiffré dans docs/charge.md avec la capacité par machine.
2. Fournisseurs d'IA :
   - délais maximum ;
   - nouvelles tentatives espacées avec gigue (3 au plus, seulement sur les erreurs temporaires) ;
   - coupe-circuit par fournisseur ;
   - message clair à l'utilisateur, et reprise de la génération là où elle s'est arrêtée.
3. Objectifs de service écrits (docs/slo.md), mesurés par les métriques d'A3.
4. Page d'état publique (Upptime sur GitHub Pages, ou Instatus), et surveillance depuis l'extérieur.
5. docs/runbooks/ : base saturée, file de rendu bloquée, fournisseur en panne, pic d'inscriptions, clé compromise,
   restauration (déjà fait en A5), retour arrière.

Fini quand : la capacité est connue et écrite ; un fournisseur coupé ne bloque plus rien (test) ; la page d'état est
en ligne.
```

### C3 · Préparation du test d'intrusion

```text
Tâche : [FR 2.10], avec [FR 2.12].

1. docs/securite/modele-de-menaces.md : actifs, surfaces (API, WebSocket, envois de fichiers, fournisseurs, rendu,
   back-office, paiement), menaces et parades existantes.
2. Revue de sécurité complète du code (utilise /security-review) : autorisations de chaque route, isolation des
   espaces, liens signés, WebSocket, envois de fichiers, formules et patchs du moteur, back-office. Corrige ce qui
   est trouvé, avec un test pour chaque faille.
3. Injection de consignes : le texte et les documents de l'utilisateur sont toujours présentés au modèle comme des
   données balisées. Tests avec des documents piégés.
4. /.well-known/security.txt, adresse de signalement, politique de divulgation.
5. Un cahier des charges pour le test d'intrusion externe (périmètre, comptes de test, préproduction), à envoyer
   au prestataire que le propriétaire choisira.

Fini quand : la revue est faite et ses failles corrigées ; le cahier des charges est prêt.
Le test externe lui-même est fait par des humains.
```

### C4 · Revue du jour d'ouverture

```text
Reprends la « Liste de contrôle du jour d'ouverture » de docs/FEUILLE_DE_ROUTE.md. Pour chaque ligne :
- vérifie sur la préproduction ou la production, preuves à l'appui (captures, sorties de commande, liens) ;
- corrige ce qui manque.

Écris docs/ouverture.md : l'état de chaque point, qui est d'astreinte la première semaine, et le plan de retour
arrière répété. Liste ce qui reste au propriétaire (avocat, test d'intrusion, Stripe réel).

Fini quand : tous les points sont verts ou ont une décision écrite du propriétaire.
Alors seulement : SIGNUP=open.
```

---

## Étape D : montée en charge et version 1.0

### D1 · Stockage objet et CDN

```text
Tâche : [FR 3.6].

- Couche de stockage abstraite (apps/api/src/storage/) : disque local (actuel) ou S3 compatible (STORAGE=s3,
  STORAGE_BUCKET, point d'accès, région ; identifiants dans l'environnement).
- Vidéos, voix, images et médias de la communauté y passent. Liens signés du stockage, ou nos liens signés
  existants en proxy.
- Migration des fichiers existants par un script reprenable.
- Cycle de vie : suppression des rendus selon le plan.
- CDN devant les vidéos publiées.
- Le rendu écrit ses morceaux localement, puis envoie le résultat.

Fini quand : tous les tests passent avec STORAGE=s3 (MinIO en CI) ; migration essayée sur une copie de la
préproduction.
```

### D2 · Workers, reprise des rendus, mises à jour sans coupure

```text
Tâches : [FR 3.8] [FR 3.9] [FR 3.12].

- Rendu : les blocs terminés sont gardés. Un rendu interrompu (redémarrage, worker perdu) reprend au premier bloc
  manquant au lieu d'échouer. Tests en tuant un worker au milieu.
- Nombre de workers ajusté à la longueur de la file (métrique d'A3) : script ou règle de l'hébergeur, de 1 à N.
  Limites de CPU et de mémoire par conteneur.
- Arrêt en douceur de l'API : finir les requêtes, prévenir les clients en direct (reconnexion transparente), ne
  plus prendre de rendu.
- Migrations écrites en deux temps (ajouter, puis utiliser, puis retirer), avec un contrôle en CI qui refuse une
  migration destructive en une seule étape.
- docs/runbooks/reprise.md : RTO 4 h et RPO 15 min, procédure répétée.

Fini quand : un déploiement en préproduction pendant une édition en direct et un rendu ne perd ni l'un ni l'autre
(test manuel décrit et fait).
```

### D3 · Rotation des clés, isolation de FFmpeg, sessions, 2FA des utilisateurs

```text
Tâches : [FR 2.6, utilisateurs] [FR 2.7] [FR 2.8] [FR 2.11] [FR 2.12 si pas fait].

- SecretBox avec plusieurs clés :
  - chaque secret scellé garde l'identifiant de sa clé ;
  - APP_ENCRYPTION_KEYS (liste, la première sert à sceller) ;
  - commande de rechiffrement de tous les secrets ;
  - procédure dans un runbook ;
  - tests de rotation.
- FFmpeg :
  - processus sans réseau (namespace ou conteneur de workers à part) ;
  - limites de temps, de mémoire et de CPU ;
  - arrêt sur dépassement ;
  - tests avec des fichiers hostiles (très longs, très lourds, corrompus).
- Page « Mes sessions » : appareils, dernière activité, fermer une session ou toutes les autres.
- TOTP et clés d'accès proposés aux utilisateurs, et obligatoires pour les propriétaires d'espaces payants s'ils
  le souhaitent.

Fini quand : chaque point a ses tests ; une rotation complète a été faite en préproduction.
```

### D4 · Accessibilité

```text
Tâche : [FR 5.15].

- Audit RGAA / WCAG 2.1 AA, d'abord automatique (axe-core dans les e2e sur toutes les pages), puis à la main :
  clavier, lecteur d'écran (NVDA ou VoiceOver), zoom à 200 %, contrastes, mouvement réduit.
- Corrections, en commençant par le parcours d'achat (Acte européen sur l'accessibilité) et l'inscription.
- Éditeur : frise et scène utilisables au clavier, annonces pour les lecteurs d'écran.
- Déclaration d'accessibilité publiée.

Fini quand : zéro erreur axe sur toutes les pages ; parcours d'achat au clavier et au lecteur d'écran en e2e.
```

### D5 · Interface en anglais

```text
Tâche : [FR 7.6].

- Extraction des textes de apps/web, apps/admin et des e-mails dans des fichiers de langue (i18next ou un module
  simple) ; français et anglais.
- Formats de date et de nombre selon la langue.
- Langue choisie dans le profil, et proposée selon le navigateur.
- Les messages d'erreur de l'API portent un code, traduit dans l'interface.
- Les consignes aux modèles d'IA restent telles quelles ; la langue du film est déjà un choix à part.

Fini quand : toute l'interface existe en anglais (vérifié par un test qui cherche les textes non traduits) et les
e2e tournent dans les deux langues.
```

### D6 · Aide, e-mails, performances, erreurs, mesure d'audience

```text
Tâches : [FR 7.3] [FR 7.5] [FR 7.7] [FR 7.8] [FR 7.9].

- Centre d'aide (pages Markdown dans l'application, recherche) : créer, joindre des modèles, relire, rendre,
  publier, facturer, confidentialité.
- E-mails : bienvenue, rendu terminé, génération terminée, paiement réussi ou échoué, fin d'essai ; préférences et
  désabonnement.
- Performances :
  - budget de poids de l'éditeur, surveillé en CI ;
  - chargement à la demande (pdf.js, styles lourds) ;
  - ouverture d'un projet en moins de 2 s sur un portable moyen (mesure Playwright).
- Revue de tous les messages d'erreur et des états vides.
- Mesure d'audience sans cookie (Plausible ou Matomo configuré sans cookie), entonnoir inscription → premier film →
  rendu → abonnement.

Fini quand : chaque point est vérifié par un test ou une mesure écrite.
```

### D7 · Facturation, drapeaux, préproduction, modèles de projets

```text
Tâches : [FR 9.3] [FR 9.4] [FR 10.3] [FR 10.4] [FR 10.5] [FR 10.7] [FR 1.5] [FR 1.7] [FR 4.5] [FR 7.10] [FR 8.3].

- Back-office : revenus et coûts d'IA par plan et par mois ; marge.
- Codes promotionnels, essai Premium, tarif annuel (Stripe).
- Drapeaux de fonctionnalités par espace ou par pourcentage (table et interface dans le back-office).
- Tests de bout en bout rejoués sur la préproduction après chaque déploiement.
- Tests de migration sur une copie anonymisée de la production.
- Tests qui échouent au hasard sous charge : isoler ou allonger les délais.
- docs/adr/ et CONTRIBUTING.md.
- Modèles de projets : publicité, explication, typographie animée, données, vertical ; choisis à la création.
- Niveaux de confiance et limites de publication des nouveaux comptes ; partage et intégration d'un film.
```

---

## Moteur, phases 2 à 6

Pour chaque prompt : lis la phase correspondante dans docs/moteur/plan.html. Respecte « Ce que fini veut dire pour
un lot » (dernière section du plan) et les critères d'acceptation de la phase. Chaque fonction nouvelle est
disponible pour le modèle d'IA (consignes et contrôles), réglable dans l'éditeur, et mesurée quand elle peut mal
tourner.

### M2a · Bézier, trajectoires, ressorts

```text
Lots [M 2.1] [M 2.2] [M 2.3].
- Bézier temporel par clé (Newton + dichotomie).
- Chemins spatiaux Catmull-Rom centripètes avec tangentes automatiques ou explicites, clés itinérantes (vitesse
  constante), orientation automatique.
- Interpolation ressort par solution analytique, en gardant la vitesse de la clé précédente.
Tests de propriétés (fast-check) : continuité de la vitesse aux clés intérieures, pas de dépassement pour le
ressort critique. Aucun changement sur les projets v1.
```

### M2b · Fondus de poses, couches, formules, remappage du temps

```text
Lots [M 2.4] [M 2.5] [M 2.6].
- Fondu entre poses (0,2 à 0,4 s, plus court chemin angulaire), couches par groupe de parties avec poids, accord
  des phases entre cycles.
- engine/src/expr.ts : analyseur de Pratt, fonctions permises du plan, budget de 200 nœuds, erreurs positionnées,
  aucun accès en dehors de ses arguments.
- Remappage du temps (ralenti, arrêt sur image, boucle, aller-retour, piste time animable).
Tests : une partie ne tourne pas de plus de 0,1 rad par image lors d'un changement de pose ; une batterie de
formules hostiles (profondeur, taille, noms inconnus) toutes refusées proprement.
```

### M2c · Éditeur de courbes et trajectoires

```text
Lot [M 2.7].
- Graphe de valeur et de vitesse par propriété, avec poignées de Bézier.
- Trajectoire dessinée sur la scène avec poignées déplaçables.
- Pelures d'oignon à ± 3 images.
- Annuler et refaire, édition en direct à plusieurs respectée.
e2e pour chaque outil ; captures regardées.
```

### M3a · Rig standard et bibliothèque d'actions

```text
Lots [M 3.1] [M 3.2].
- Nomenclatures humanoid et quadruped, vérifiées à la génération des dessins (consignes de packages/ai/src/drawing.ts
  mises à jour), retargeting par longueur des membres.
- Actions à clés par partie (une fois ou en boucle, intensité 0 à 2).
- packages/library/src/actions/ : les ≈ 40 actions humanoïdes du plan, chacune avec sa planche de contrôle regardée.
```

### M3b · Parentage, IK, locomotion

```text
Lots [M 3.3] [M 3.4] [M 3.5].
- parent: { element, part } avec changement de parent sans saut.
- IK à 2 os analytique (sens de pliure), FABRIK pour les chaînes longues, mélange IK et cinématique directe.
- Phase de marche calée sur la distance, pieds verrouillés pendant l'appui, ligne de sol du décor.
Critères : glissement des pieds ≤ 4 px, cible atteinte à 1 px, film 2 du banc d'essai (publicité avec mascotte)
sans écart de mesure.
```

### M3c · Mouvement secondaire et déformation

```text
Lots [M 3.6] [M 3.7].
- Ressorts angulaires à pas fixe (1/240 s), points de reprise toutes les 0,5 s.
- Squash & stretch à volume constant, écrasement automatique à l'atterrissage.
- Membres souples.
- Peau sur os avec poids automatiques.
Tests de reprise : sauter directement à t = 17,3 s donne la même image que dérouler depuis 0 ; morceaux identiques.
```

### M3d · Vues, humeurs, visèmes, foules

```text
Lots [M 3.8] [M 3.9] [M 3.10] [M 3.11].
- Vues front, q34, side, back partageant les parties ; se retourner par les vues intermédiaires.
- Transition d'humeur take.
- Visèmes V1 (enveloppe de la voix), puis V2 (phonèmes du français alignés par Whisper) ; clignement semé ; regard.
- Foules d'instances variées.
Film 3 du banc d'essai (dialogue) sans écart de mesure, relu sur planches.
```

### M3e · Personnages : côté IA et éditeur

```text
Lot [M 3.12].
- Chaque dessin produit une fiche (poses, expressions, vues), relue par le modèle qui voit.
- Éditeur :
  - panneau de rig : parties, cibles d'IK déplaçables ;
  - bibliothèque d'actions avec aperçu ;
  - clés par partie dans la frise.
e2e et captures.
```

### M4a · Brief-contrat, voix d'abord, validation des fiches

```text
Lots [M 4.1] [M 4.2] [M 4.3].
- Brief-contrat extrait après le storyboard (faits, noms, chiffres avec leur format, éléments à montrer), validé par
  l'utilisateur, vérifié contre les textes des scènes puis contre la voix retranscrite (Whisper local ou
  fournisseur).
- Répliques enregistrées avant l'écriture des scènes.
- Point d'arrêt « fiches, images de style, voix » dans la page de génération, avec la liste des décisions à prendre.
Tests avec le modèle bouchon ; e2e du parcours.
```

### M4b · Scène modèle, guide chiffré, exemples

```text
Lots [M 4.4] [M 4.5].
- La scène 1 est écrite, mesurée et relue jusqu'à passer tous les critères, puis envoyée en exemple pour les autres
  scènes (en parallèle).
- Vérification de la continuité (tailles, côtés, costumes) d'une scène à l'autre.
- Guide d'animation chiffré dans les consignes.
- Bibliothèque d'exemples par genre ; seul le genre demandé est montré au modèle.
Mesure : écarts au premier jet sur le banc d'essai, avec et sans scène modèle (−50 % attendu).
```

### M4c · Intentions compilées en clés

```text
Lot [M 4.6].
- engine/src/intents.ts : enter, exit, walkTo, runTo, jump, throwTo, hold, lookAt, say, react, frame (cadrage :
  plan et tiers), pushIn, reveal, countTo.
- Compilation déterministe, avec anticipation, arcs et durées tirés du guide.
- Schéma, consignes au modèle et contrôles mis à jour.
Tests : chaque intention compilée passe les mesures ; une scène écrite seulement en intentions tient les critères.
```

### M4d · Le modèle interroge le moteur

```text
Lot [M 4.7].
- Appel d'outils dans packages/providers (OpenAI, Anthropic, Gemini, Mistral).
- Outils positionOf, boundsOf, cues, actionsOf, freeRegions dans packages/ai/src/tools.ts, 8 appels au plus par
  scène.
- Repli sans outils pour les fournisseurs qui ne les ont pas.
Tests avec des bouchons de chaque dialecte.
```

### M5a · Calques de formes, opérateurs, morphing

```text
Lots [M 5.1] [M 5.2] [M 5.3].
- Élément shape (rectangle arrondi, ellipse, étoile, polygone, chemin), contours (pointillés, effilés), dégradés.
- Opérateurs : tracé progressif calculé dans le moteur, répétiteur, décalage, onde, zigzag, torsion, arrondi,
  fusion booléenne (polygon-clipping).
- Morphing avec appariement des points, et raccord de forme entre plans.
Film 6 du banc d'essai (révélation de logo).
```

### M5b · Typographie animée

```text
Lots [M 5.4] [M 5.5].
- Animateurs par glyphe, mot ou ligne, avec sélecteurs de plage et préréglages.
- Texte sur chemin.
- Compteurs avec formateur maison (espace fine, virgule).
- Écriture manuscrite sur une police Hershey (domaine public).
Film 4 du banc d'essai (typographie animée).
```

### M5c · Masques, fusion, effets

```text
Lots [M 5.6] [M 5.7], dans styles/src/composite.ts et styles/src/effects/.
- Masques adoucis et inversés, caches alpha et luminance, modes de fusion natifs.
- Flou (3 boîtes), ombre, lueurs, niveaux, teinte, table 3D .cube, grain, aberration.
- Chaque effet déclare son coût.
Images dorées identiques entre Node et Chromium ; budget par image respecté.
```

### M5d · Compositions imbriquées et transitions

```text
Lots [M 5.8] [M 5.9].
- project.comps et élément comp (remappage, boucle, décalage, profondeur 8, cycles refusés, cache).
- Timeline avec recouvrement des scènes pendant une transition.
- Bibliothèque de transitions du plan (volets, iris, poussée, zoom, panoramique filé, pinceau, coupure numérique,
  raccord de forme).
```

### M5e · 2,5D et caméra

```text
Lot [M 5.10].
- Profondeur z, rotation X et Y des calques, focale, parallaxe automatique, tri par z.
- Travelling compensé, profondeur de champ en 3 niveaux, ombres portées au sol.
- Préréglages de caméra.
Film 8 du banc d'essai (démonstration d'interface).
```

### M5f · Gabarits, variables, charte, formats

```text
Lot [M 5.11].
- Variables typées liées aux paramètres, rendu par lots depuis un CSV (quotas des plans respectés).
- Charte de marque de l'espace (polices importées réservées à l'espace, couleurs, logos), imposée et vérifiée.
- Retouches par format.
Film 11 du banc d'essai (infographie à déclinaisons).
```

### M5g · Données et musique

```text
Lot [M 5.12].
- Élément chart (barres, lignes, secteurs, aires, cartes simples), animations de croissance et de tracé, valeurs
  exactes.
- TimeRef { beat } (exact pour la musique composée, estimé pour une musique jointe), amp et beat dans les formules.
Films 7 (données) et 10 (clip vertical) du banc d'essai.
```

### M5h · Motion design : côté IA et éditeur

```text
Lot [M 5.13].
- Consignes de motion design (mise en page, hiérarchie, rythme de lecture) et exemples par genre.
- Éditeur :
  - outils rectangle, ellipse et plume ;
  - opérateurs, animateurs de texte, effets ;
  - masques à la plume ;
  - variables et rendu par lots.
e2e et captures.
```

### M6a · Particules et cordes

```text
Lots [M 6.1] [M 6.2].
- Particules sans état (fonctions de l'âge : balistique avec traînée exacte, bruit de curl), émetteurs et évolution
  sur la vie, rebond au sol.
- Cordes et tissus en Verlet à pas fixe avec points de reprise.
Film 12 du banc d'essai (foule, confettis, feux d'artifice) : 10 000 particules sous 50 ms par image.
```

### M6b · Rendu GPU

```text
Lot [M 6.3].
- packages/styles/src/gpu/ : WebGL2, style plat d'abord, triangulation earcut, effets en shaders.
- Aperçu temps réel dans l'éditeur.
- Rendu serveur en option (SwiftShader, ou machine avec GPU).
Images dorées comparées au rendu Canvas ; 60 i/s d'aperçu sur les films 4 et 6.
```

### M6c · Exports

```text
Lot [M 6.4].
- Lottie (sous-ensemble vectoriel, style plat), comparé au rendu de lottie-web.
- WebM VP9 avec transparence (yuva420p), ProRes 4444, séquence PNG.
- Pistes audio séparées.
Options dans le panneau de rendu ; tests par format.
```

### M6d · Plusieurs langues

```text
Lot [M 6.5].
- Traduction des répliques et des textes en gardant le brief-contrat (chiffres, noms).
- Voix par langue, timeline recalculée, textes remis en page (y compris de droite à gauche).
- Une version du film par langue.
```

### M6e · Performance

```text
Lot [M 6.6].
- Cache d'image par élément quand ses primitives ne changent pas (empreinte).
- Aperçu à mi-résolution pendant le défilement.
- Profilage de frameAt par étape, affiché dans l'éditeur.
Mesures avant et après sur le banc d'essai, dans le rapport.
```

---

## Prompts utiles à tout moment

### Reprendre une session interrompue

```text
Reprends le travail du prompt <ID> de NEXT_PROMPTS.md.
- Lis le dernier commit et git status pour savoir où tu en es.
- Relance pnpm typecheck && pnpm test.
- Termine ce qui manque selon le critère « Fini quand » du prompt.
Même préambule et mêmes règles.
```

### Revue avant fusion

```text
Relis la branche <nom> par rapport à la branche principale, comme un relecteur exigeant :
- bugs, sécurité (secrets, autorisations, SSRF, injections) ;
- déterminisme du moteur ;
- compatibilité des projets existants ;
- tests manquants ;
- documentation.
Utilise /code-review et /security-review. Corrige ce qui est sûr, liste le reste avec sa gravité.
```

### Mettre la feuille de route à jour

```text
Compare docs/FEUILLE_DE_ROUTE.md, docs/moteur/plan.html et ce fichier à l'état réel du code :
- coche ce qui est fait (avec le commit) ;
- ajoute ce qui a été découvert ;
- réordonne si les priorités ont changé.
Ne supprime rien sans le dire dans ton rapport.
```
