# Journal des changements

Toutes les modifications notables d'animation-flow. Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ;
numéros de version : [Semantic Versioning](https://semver.org/lang/fr/).

## [Non publié]

## [0.9.0] - 2026-09-29

Première version numérotée : tout ce qui existe jusqu'ici, plus les correctifs de l'étape A1 de `NEXT_PROMPTS.md`.

### Ajouté

- Sonde de disponibilité `GET /api/ready`, distincte de la sonde de vie `GET /api/health` : elle vérifie la base, l'écriture
  dans `DATA_DIR` et la présence de FFmpeg, et répond 503 sinon. Les healthchecks Docker l'utilisent.
- Version et commit exposés par `GET /api/health` (application et back-office) et affichés dans le pied du back-office.
  L'image Docker reçoit le commit par `--build-arg APP_COMMIT=…`.
- Ce journal des changements.
- Workflow d'intégration continue complété (navigateur de Playwright en cache, `pnpm audit --prod`, envoi d'une image
  de 12 Mo à travers nginx dans le job Docker). Il ne se lance qu'à la main : l'intégration continue est reportée au
  déploiement.

### Corrigé

- nginx coupait les envois de fichiers à 10 Mo alors que l'API accepte des images de 15 Mo et des musiques de 60 Mo :
  `/api/uploads/` accepte maintenant 64 Mo, avec des délais adaptés aux envois lents.
- Une connexion que PostgreSQL ferme (redémarrage, bascule) faisait tomber le processus : elle est maintenant écartée
  et la suivante rouverte. Tant que la base est injoignable, les requêtes répondent 503 au lieu de 500.
- Tests de l'API sur PostgreSQL : une deuxième base de test effaçait la première ; chacune a maintenant son schéma.

### Déjà là avant la numérotation

Fondations (format, moteur, éditeur, fournisseurs et clés, Docker) ; rendu serveur (file dans PostgreSQL, workers,
MP4 avec sous-titres) ; narration et son ; génération par IA ; comptes, espaces et rôles ; édition à plusieurs en
temps réel, commentaires, e-mail ; communauté, plans et paiements, back-office ; six styles, formats vertical, carré
et portrait, MP4, WebM et GIF. Détails : `README.md` et `docs/ARCHITECTURE.md`.

[Non publié]: https://github.com/THackSRT/animation-flow/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/THackSRT/animation-flow/releases/tag/v0.9.0
