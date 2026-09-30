# Journal des changements

Toutes les modifications notables d'animation-flow. Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ;
numéros de version : [Semantic Versioning](https://semver.org/lang/fr/).

## [Non publié]

### Sécurité

- **Faille critique corrigée** : un chemin encodé (`/%61pi/admin/…`) atteignait les routes du back-office sans session
  ni contrôle CSRF (lecture des comptes, suspension, changement de plan), et sans ligne au journal d'audit. Les
  contrôles se décident maintenant sur la route trouvée.
- Changer l'adresse d'une clé enregistrée demande de saisir la clé à nouveau : un administrateur d'espace ne peut
  plus envoyer la clé du propriétaire vers un serveur à lui.
- Les adresses de fournisseurs ne peuvent plus viser le réseau du serveur (SSRF) : adresses privées, locales, de
  lien local et de métadonnées refusées après résolution et à chaque redirection, connexion à l'adresse vérifiée,
  délai et taille plafonnés. **À savoir** : une clé enregistrée vers un serveur local (Ollama sur `localhost`) cesse
  de fonctionner tant que `ALLOW_PRIVATE_PROVIDERS=true` n'est pas mis sur un serveur privé (qui n'ouvre jamais le
  service de métadonnées du nuage).
- En-têtes de sécurité sur l'application : `Content-Security-Policy` stricte, `Strict-Transport-Security` en HTTPS,
  `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` ; le back-office reçoit la même CSP.
- nodemailer 10 (corrige 12 vulnérabilités connues, dont 2 hautes). `pnpm audit --prod --audit-level high` bloquant,
  analyse de l'image par Trivy (épinglé par empreinte) et SBOM CycloneDX dans le workflow d'intégration continue
  (lancé à la main jusqu'au déploiement) ; npm et corepack retirés de l'image. Configuration Renovate : mises à jour
  hebdomadaires groupées, correctifs fusionnés seuls une fois la CI verte (l'application s'installe au déploiement).

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
