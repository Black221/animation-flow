# Feuille de route : une plateforme stable, déployée et ouverte au public

Ce document liste tout ce qu'il reste à faire pour passer d'une application qui marche (tests verts, campagne Dakar 2026
générée de bout en bout) à un service public :

- stable et surveillé ;
- sûr face à des inconnus ;
- conforme au droit français et européen ;
- utilisable sans avoir ses propres clés d'IA.

Il reprend aussi ce qui avait été laissé « à faire » pendant le développement.

Les améliorations du moteur d'animation ont leur propre plan : [docs/moteur/plan.html](moteur/plan.html) (7 phases,
57 lots), et leurs schémas : [docs/moteur/moteur.html](moteur/moteur.html). Ici, on ne reprend que la part du moteur
utile avant l'ouverture.

**Priorités**

| code | sens |
|---|---|
| **P0** | bloquant : rien d'ouvert au public tant que ce n'est pas fait |
| **P1** | dans les semaines qui suivent l'ouverture, avant la montée en charge |
| **P2** | ensuite |

**Effort**

| code | durée |
|---|---|
| **S** | ≤ 2 jours |
| **M** | ≤ 2 semaines |
| **L** | plus de 2 semaines |

---

## 0. Où on en est

Déjà fait et testé (271 tests unitaires et d'API, 27 tests de bout en bout dans Chromium) :

- **Création**
  - éditeur avec aperçu en direct, 6 styles, formats 16:9, 9:16, 1:1 et 4:5 ;
  - rendu serveur MP4, WebM et GIF, par blocs en parallèle, avec sous-titres ;
  - voix (Fish Audio et autres), musique et bruitages composés, mixage à −16 LUFS.
- **IA**
  - génération complète (storyboard relu, dessins relus en image, musique, scènes) ;
  - modèles joints au prompt (images, musique, texte, projet).
- **Collaboration et comptes**
  - comptes, espaces, rôles, invitations, édition à plusieurs en temps réel, commentaires ;
  - e-mails d'invitation et de mot de passe oublié.
- **Communauté et paiement**
  - publication, remix, signalement ;
  - plans Gratuit, Premium et Pro, paiement Stripe ;
  - back-office séparé (gérants, audit, modération).
- **Sécurité déjà en place**
  - clés d'IA chiffrées (AES-256-GCM), jamais renvoyées au navigateur ;
  - protection CSRF ;
  - limites sur les connexions, inscriptions et mots de passe oubliés ;
  - fichiers joints décodés et redessinés.
- **Déploiement**
  - Docker, PostgreSQL, plusieurs API derrière un répartiteur (nginx), workers de rendu séparables.

Ce qui manque se range en 11 chantiers, ci-dessous, puis en 4 étapes de lancement (section 12).

---

## 1. Défauts connus à corriger

| # | Tâche | Pourquoi | Prio | Effort |
|---|---|---|---|---|
| 1.1 | Porter `client_max_body_size` de `deploy/nginx.conf` à 64 Mo pour `/api/uploads/*` (et corriger le commentaire, qui parle encore de 8 Mo) | l'API accepte des images de 15 Mo et des musiques de 60 Mo, mais nginx coupe à 10 Mo : l'envoi échoue derrière le répartiteur | P0 | S |
| 1.2 | Relancer l'intégration continue à chaque push et pull request (`.github/workflows/ci.yml` est en déclenchement manuel, parce que GitHub Actions ne démarrait pas de tâches sur ce compte) | aujourd'hui, rien ne vérifie automatiquement une modification | P0 | S |
| 1.3 | « Toutes les répliques ont leur voix » s'affiche avant que les deux dernières voix soient enregistrées dans le projet (vu pendant la campagne : lues sans durée juste après) | l'utilisateur peut lancer un rendu sans les dernières voix | P1 | S |
| 1.4 | ~~Mettre à jour la feuille de route du README~~ : fait avec ce document | documentation à jour | fait | S |
| 1.5 | Modèles de projets : en proposer davantage (publicité, explication, typographie animée, données, vertical pour les réseaux), choisis à la création | seuls 3 modèles existent ; c'était la prochaine étape prévue | P1 | M |
| 1.6 | Voix : le modèle payant Fish Audio `s2.1-pro` a répondu 402 (pas de crédit API), et c'est le modèle gratuit qui a servi | le modèle gratuit n'a pas de garantie de délai ; en production, prendre un crédit et le surveiller | P0 | S |
| 1.7 | Vérifier les tests qui échouent quand la machine est très chargée (délais de 5 à 10 s en auth, plans, live, cluster pendant un rendu) : allonger les délais ou isoler ces tests du rendu en intégration continue | éviter les échecs au hasard en intégration continue | P1 | S |

---

## 2. Sécurité face au public

| # | Tâche | Pourquoi | Prio | Effort |
|---|---|---|---|---|
| 2.1 | **Bloquer le SSRF sur les adresses de fournisseurs** : une clé « compatible OpenAI » accepte n'importe quel `baseUrl`, et le serveur appelle cette adresse. Pour un serveur public, refuser les adresses privées, locales et de métadonnées (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, ::1, fc00::/7, `metadata.google.internal`…), après résolution DNS et à chaque redirection. Option `ALLOW_PRIVATE_PROVIDERS=true` pour les serveurs privés (Ollama en local) | aujourd'hui, un inconnu pourrait faire appeler par le serveur ses services internes | **P0** | M |
| 2.2 | En-têtes de sécurité sur l'application (le back-office les a déjà, pas l'application) : `Content-Security-Policy` stricte (scripts du site seulement, `frame-ancestors 'none'`, `connect-src` limité), `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` | limiter l'effet d'une faille XSS et l'intégration dans un cadre | **P0** | S |
| 2.3 | **Vérifier l'adresse e-mail à l'inscription** (lien à usage unique) avant de pouvoir générer, publier ou inviter | avec `SIGNUP=open`, n'importe qui crée des comptes jetables | **P0** | M |
| 2.4 | Protection anti-robots à l'inscription et au mot de passe oublié (Cloudflare Turnstile ou hCaptcha, sans pistage) | création de comptes en masse, abus des quotas gratuits | **P0** | S |
| 2.5 | Limites de débit générales, par utilisateur et par adresse : toutes les écritures, la génération, les envois de fichiers, les rendus, les signalements, la publication. Stockées dans PostgreSQL pour valoir sur toutes les instances | aujourd'hui, seuls la connexion, l'inscription et le mot de passe oublié sont limités | **P0** | M |
| 2.6 | Double authentification (TOTP, puis clés d'accès WebAuthn) : obligatoire pour les gérants du back-office, proposée aux utilisateurs | un compte de gérant volé donne accès à tout | P0 (gérants), P1 (utilisateurs) | M |
| 2.7 | Rotation de `APP_ENCRYPTION_KEY` : chaque secret chiffré garde l'identifiant de la clé qui l'a scellé, plusieurs clés actives sont acceptées, puis tout est rechiffré | aujourd'hui, changer la clé rend toutes les clés stockées illisibles | P1 | M |
| 2.8 | Isoler FFmpeg (qui décode des fichiers envoyés par des inconnus) : processus sans réseau, limites de temps, de mémoire et de CPU, conteneur à part pour les workers | une faille de décodeur ne doit pas compromettre l'API | P1 | M |
| 2.9 | Audit des dépendances à chaque build (`pnpm audit`, Renovate ou Dependabot), analyse de l'image Docker (Trivy), inventaire des composants (SBOM) | vulnérabilités connues dans les bibliothèques | P0 | S |
| 2.10 | Test d'intrusion externe avant l'ouverture, puis un par an ; `/.well-known/security.txt` et une adresse de signalement des failles | regard extérieur ; que les chercheurs sachent où écrire | P0 (avant la bêta ouverte) | M |
| 2.11 | Page « Mes sessions » : appareils connectés, dernière activité, fermeture à distance | un utilisateur doit pouvoir couper une session volée | P1 | S |
| 2.12 | Filtrer les instructions cachées dans les documents joints au prompt (injection de consignes) : texte de l'utilisateur toujours présenté au modèle comme des données, jamais comme des consignes | un document piégé ne doit pas détourner la génération | P1 | S |

---

## 3. Infrastructure et déploiement

| # | Tâche | Pourquoi | Prio | Effort |
|---|---|---|---|---|
| 3.1 | Choisir l'hébergement (UE de préférence, pour le RGPD) : une VM ou plusieurs avec Docker Compose au départ (OVHcloud, Scaleway, Hetzner), Kubernetes plus tard si besoin | décision qui conditionne le reste | **P0** | S |
| 3.2 | Nom de domaine, HTTPS automatique (Caddy ou Traefik avec Let's Encrypt), redirection de HTTP vers HTTPS, `APP_URL`, `COOKIE_SECURE=true`, `TRUST_PROXY` réglé sur le répartiteur | la base d'un service public | **P0** | S |
| 3.3 | Trois environnements : développement, préproduction (données fictives, même configuration que la production) et production. Déploiement automatique en préproduction à chaque fusion, en production sur étiquette de version | tester une mise à jour avant les utilisateurs | **P0** | M |
| 3.4 | PostgreSQL géré ou répliqué : sauvegardes quotidiennes et journal pour revenir à n'importe quel instant (PITR, 30 jours), chiffrées, copiées dans une autre région | une perte de base ne doit pas être définitive | **P0** | M |
| 3.5 | **Test de restauration** mensuel, écrit dans un runbook : restaurer la sauvegarde dans un environnement vide et vérifier projets, clés et vidéos | une sauvegarde jamais restaurée n'est pas une sauvegarde | **P0** | S |
| 3.6 | Stockage objet compatible S3 pour les vidéos, voix, images et médias de la communauté (aujourd'hui un disque partagé), avec liens signés, cycle de vie (suppression des rendus anciens selon le plan) et réseau de diffusion (CDN) pour les vidéos publiées | un disque partagé ne passe pas l'échelle et se perd avec la machine | P0 (sauvegarde du disque) / P1 (S3) | L |
| 3.7 | Gestion des secrets : `APP_ENCRYPTION_KEY`, Stripe, SMTP et clés de la plateforme dans un coffre (variables chiffrées de l'hébergeur, Vault ou SOPS), jamais dans un fichier du dépôt | fuite de secrets | **P0** | S |
| 3.8 | Workers de rendu à part, en nombre ajusté à la longueur de la file d'attente (de 1 à N), avec limites de CPU et de mémoire. Un rendu interrompu par un redémarrage doit reprendre depuis son dernier bloc terminé, au lieu d'échouer comme aujourd'hui | coût maîtrisé, pas de rendu perdu pendant une mise à jour | P1 | M |
| 3.9 | Mises à jour sans interruption : arrêt en douceur (finir les requêtes, fermer proprement les WebSocket), migrations de base compatibles avec la version précédente (ajouter, puis utiliser, puis retirer) | déployer sans couper l'édition en direct | P1 | M |
| 3.10 | Sonde de disponibilité distincte de la sonde de vie : `/api/ready` vérifie la base, le stockage et FFmpeg | le répartiteur n'envoie pas de trafic à une instance malade | P0 | S |
| 3.11 | Limites de l'hébergement : taille des requêtes, délais du répartiteur (les WebSocket vivent 1 h, les envois de fichiers ont besoin de temps), compression, cache des fichiers de l'éditeur (empreintes dans les noms) | fiabilité et vitesse | P0 | S |
| 3.12 | Plan de reprise après sinistre : objectif de reprise (RTO 4 h) et de perte (RPO 15 min), procédure écrite et répétée | savoir quoi faire le jour où tout tombe | P1 | S |

---

## 4. Surveillance et fiabilité

| # | Tâche | Pourquoi | Prio | Effort |
|---|---|---|---|---|
| 4.1 | Journaux structurés centralisés (Loki, Grafana Cloud ou l'outil de l'hébergeur), avec un identifiant par requête ; données personnelles et secrets masqués (déjà fait pour les en-têtes d'authentification, à vérifier partout) ; conservation 30 jours | comprendre un incident | **P0** | M |
| 4.2 | Métriques (Prometheus sur `/metrics`, réservé au réseau interne) :<br>• requêtes, délais et erreurs par route ;<br>• connexions en direct ;<br>• file de rendu (attente, durée, échecs) ;<br>• appels d'IA (durée, erreurs, jetons, coût) ;<br>• envois d'e-mails ;<br>• webhooks Stripe. | voir la santé du service | **P0** | M |
| 4.3 | Suivi des erreurs, côté serveur et côté navigateur (Sentry ou GlitchTip hébergé en UE), avec les données personnelles retirées | être prévenu d'une erreur avant l'utilisateur | **P0** | S |
| 4.4 | Alertes : service injoignable, taux d'erreurs, file de rendu bloquée, base presque pleine, sauvegarde manquée, certificat qui expire, webhook Stripe en échec, coûts d'IA anormaux | réagir vite | **P0** | S |
| 4.5 | Objectifs de service (SLO) publiés en interne :<br>• disponibilité de 99,5 % ;<br>• 95 % des rendus de 1 min terminés en moins de 5 min ;<br>• 95 % des générations terminées en moins de 10 min. | mesurer la fiabilité | P1 | S |
| 4.6 | Page d'état publique (Upptime ou Instatus) et surveillance de l'extérieur | informer les utilisateurs pendant une panne | P1 | S |
| 4.7 | Tests de charge (k6) : 500 utilisateurs dans l'éditeur, 50 éditions en direct à plusieurs, 20 rendus simultanés, 10 générations. Mesurer, corriger les goulots, recommencer | connaître la capacité avant qu'on la découvre | P1 | M |
| 4.8 | Runbooks : base saturée, file de rendu bloquée, fournisseur d'IA en panne, pic d'inscriptions, clé compromise, restauration | savoir quoi faire à 3 h du matin | P1 | S |
| 4.9 | Fournisseurs d'IA : délais maximum, nouvelles tentatives espacées, coupe-circuit par fournisseur, message clair à l'utilisateur quand un fournisseur est en panne | les pannes des fournisseurs ne doivent pas bloquer la plateforme | P1 | M |

---

## 5. Légal et conformité (France et UE)

| # | Tâche | Pourquoi | Prio | Effort |
|---|---|---|---|---|
| 5.1 | **Mentions légales** (éditeur, hébergeur, contact) | obligatoire (LCEN) | **P0** | S |
| 5.2 | **Conditions générales d'utilisation** :<br>• âge minimum (15 ans en France sans accord parental) ;<br>• contenus interdits ;<br>• droits sur les fichiers joints : l'utilisateur garantit avoir les droits sur les images, musiques et voix qu'il apporte, par exemple une mascotte de marque ;<br>• licence des contenus publiés et règles du remix ;<br>• responsabilité et résiliation. | obligatoire, et protège la plateforme | **P0** | M |
| 5.3 | **Conditions générales de vente** pour les plans payants : prix TTC, renouvellement, résiliation, droit de rétractation (et son renoncement explicite pour un service numérique fourni tout de suite), factures | obligatoire dès qu'on vend | **P0** | S |
| 5.4 | **Politique de confidentialité (RGPD)** :<br>• données collectées, bases légales, durées de conservation ;<br>• sous-traitants : hébergeur, Stripe, e-mail, Fish Audio, fournisseurs d'IA quand la plateforme fournit les modèles ;<br>• transferts hors UE et leurs garanties (clauses contractuelles types) ;<br>• droits des personnes et contact. | obligatoire | **P0** | M |
| 5.5 | **Supprimer son compte** (aujourd'hui on ne peut supprimer qu'un espace) : suppression des données personnelles, transfert ou suppression des espaces dont on est propriétaire, anonymisation des commentaires et des publications gardées | droit à l'effacement (RGPD, art. 17) | **P0** | M |
| 5.6 | **Exporter ses données** : un fichier avec le compte, les projets exportés (le format existe déjà), les commentaires et les factures | droit à la portabilité (RGPD, art. 20) | **P0** | M |
| 5.7 | Durées de conservation appliquées par des tâches planifiées :<br>• sessions expirées ;<br>• liens de réinitialisation ;<br>• journaux (30 jours) ;<br>• rendus (selon le plan) ;<br>• comptes non confirmés (7 jours) ;<br>• comptes supprimés (purge sous 30 jours) ;<br>• journal d'audit (1 an). | minimisation des données | P0 | M |
| 5.8 | Registre des traitements, accords de sous-traitance (DPA) signés avec chaque sous-traitant, analyse d'impact si besoin | obligations du responsable de traitement | P0 | S |
| 5.9 | Cookies : seul le cookie de session existe, sans pistage, donc pas de bandeau de consentement. Le dire dans la politique, et le garder vrai (mesure d'audience sans cookie, voir 7.9) | éviter un bandeau inutile, rester conforme | P0 | S |
| 5.10 | **Transparence sur l'IA** (AI Act, article 50) : indiquer qu'une vidéo est générée par IA dans la page publiée, dans les métadonnées du fichier et, à terme, en C2PA ; informer l'utilisateur quand il parle à un modèle | obligation en vigueur depuis le 2 août 2026 | P0 | M |
| 5.11 | **Hébergement de contenus publiés (DSA)** :<br>• signalement accessible à tous (fait) ;<br>• point de contact unique ;<br>• exposé des motifs à l'auteur quand un contenu est masqué ;<br>• possibilité de contester ;<br>• rapport de transparence annuel. | obligations des hébergeurs (DSA) | **P0** (motifs et contact) / P1 (rapport) | M |
| 5.12 | Procédure de retrait pour atteinte au droit d'auteur, avec formulaire, délai de traitement et réponse | la communauté accueillera des contenus d'autrui | P0 | S |
| 5.13 | Voix : vérifier les conditions d'utilisation des voix Fish Audio (voix publiques, clones), interdire dans les CGU le clonage de la voix d'une personne sans son accord | droit à la voix, usurpation | P0 | S |
| 5.14 | TVA : Stripe Tax (TVA française, et TVA du pays du client dans l'UE) ; factures conformes ; numéro de TVA des entreprises | obligations fiscales | **P0** | S |
| 5.15 | **Accessibilité** : le parcours d'achat relève de l'Acte européen sur l'accessibilité (en vigueur depuis juin 2025). Audit selon RGAA / WCAG 2.1 AA, puis corrections : clavier partout, contrastes, alternatives textuelles, lecteurs d'écran dans l'éditeur ; déclaration d'accessibilité | obligation pour un service de commerce en ligne, et public plus large | P1 | L |

---

## 6. IA et coûts

| # | Tâche | Pourquoi | Prio | Effort |
|---|---|---|---|---|
| 6.1 | **Modèles fournis par la plateforme** : aujourd'hui, chaque espace doit apporter ses propres clés (texte, voix, images). Pour le public, il faut des clés de la plateforme, avec un crédit inclus par plan et l'option « mes propres clés » gardée pour les experts | sans cela, un nouvel utilisateur ne peut rien générer | **P0** | L |
| 6.2 | Mesure du coût réel de chaque génération (jetons d'entrée et de sortie par modèle, secondes de voix, images) et plafonds par espace : par jour, par mois, et par génération | éviter la « facture surprise » et l'abus des comptes gratuits | **P0** | M |
| 6.3 | Calibrer les plans sur ces coûts : marge par plan, crédits supplémentaires en vente, arrêt propre quand le crédit est épuisé | modèle économique viable | **P0** | M |
| 6.4 | Choix des modèles par défaut (qualité, prix, vitesse), revus tous les trimestres avec le banc d'essai du moteur (12 films de référence) | qualité constante sans exploser les coûts | P1 | S |
| 6.5 | Modération des demandes et des sorties : texte du brief, images jointes (dont la détection de contenus pédocriminels par empreintes connues, obligatoire en pratique pour un service qui accepte des images), images rendues avant publication | usage illicite de la génération | **P0** | M |
| 6.6 | Politique de conservation des consignes et des réponses des modèles (journal des étapes) : durée, accès, et exclusion de l'entraînement chez les fournisseurs (option « zéro rétention » quand elle existe) | confidentialité des brefs des clients | P0 | S |
| 6.7 | Phases 0 et 1 du plan du moteur, avant l'ouverture : relecture du mouvement, mesures et rapport de génération (« contrôlé / non contrôlé ») | les premiers utilisateurs jugeront la plateforme sur la qualité des premiers films | P1 | L |

---

## 7. Produit et expérience du public

| # | Tâche | Pourquoi | Prio | Effort |
|---|---|---|---|---|
| 7.1 | Accueil des nouveaux : inscription, e-mail vérifié, puis premier film guidé en 3 étapes sans configuration (grâce à 6.1), exemples prêts à remixer | la première minute décide de la suite | **P0** | M |
| 7.2 | Site public : page d'accueil, tarifs, exemples, FAQ, mentions et politiques ; pages de la communauté indexables (rendu côté serveur ou pré-rendu, cartes Open Graph avec vidéo) | être trouvé, et partager un film | P0 (pages) / P1 (référencement) | M |
| 7.3 | Centre d'aide et documentation utilisateur : créer, joindre des modèles, relire, rendre, publier, facturation | moins de demandes au support | P1 | M |
| 7.4 | Support : adresse ou formulaire, délais annoncés, outil de suivi ; bouton « Signaler un problème » avec le contexte technique attaché | répondre aux utilisateurs | P0 | S |
| 7.5 | E-mails transactionnels complets : bienvenue, confirmation d'adresse, rendu terminé, génération terminée, paiement réussi ou échoué, fin de période d'essai ; lien de désabonnement pour tout ce qui n'est pas indispensable | l'utilisateur quitte souvent la page pendant un rendu | P1 | M |
| 7.6 | Interface en anglais (au moins), puis d'autres langues : textes extraits, formats de date et de nombre, e-mails traduits | public au-delà de la France | P1 | L |
| 7.7 | Performances de l'éditeur : poids des fichiers chargés (pdf.js et les styles lourds chargés à la demande), temps d'ouverture d'un projet, aperçu fluide sur un portable moyen | les premiers visiteurs n'attendent pas | P1 | M |
| 7.8 | Messages d'erreur revus : chaque erreur dit ce qui s'est passé et quoi faire ; états vides utiles | moins de frustration | P1 | S |
| 7.9 | Mesure d'audience respectueuse (Plausible ou Matomo sans cookie) et entonnoir inscription → premier film → rendu → abonnement | savoir ce qui marche | P1 | S |
| 7.10 | Parrainage et partage (lien du film, intégration sur un site) | croissance | P2 | M |

---

## 8. Modération et communauté

| # | Tâche | Pourquoi | Prio | Effort |
|---|---|---|---|---|
| 8.1 | Règles de la communauté publiées (contenus interdits, droits d'auteur, respect des personnes) | base de toute décision de modération | **P0** | S |
| 8.2 | Contrôles automatiques à la publication (texte, images du film, sons), qui envoient les cas douteux à la file de modération | on ne peut pas tout relire à la main | P0 | M |
| 8.3 | Limites de publication pour les nouveaux comptes, niveaux de confiance, et bannissement qui tient (adresse, appareil, moyen de paiement) | spam et récidive | P1 | M |
| 8.4 | Outils de modération : décisions motivées envoyées à l'auteur, contestation, historique par compte, actions en lot | obligations DSA et efficacité | P0 | M |
| 8.5 | Astreinte de modération : délais cibles (24 h, et 1 h pour les contenus graves), procédure de signalement aux autorités (PHAROS) pour les contenus illicites graves | obligations légales | **P0** | S |

---

## 9. Paiement et facturation

| # | Tâche | Pourquoi | Prio | Effort |
|---|---|---|---|---|
| 9.1 | Passer Stripe en mode production : produits et prix réels, webhook de production, tests de bout en bout (paiement, échec, renouvellement, changement de plan, résiliation, remboursement) | encaisser | **P0** | S |
| 9.2 | Factures envoyées et consultables, portail client (existe via Stripe), relances automatiques sur un échec de paiement, période de grâce avant le passage au plan gratuit | revenu et expérience | P0 | S |
| 9.3 | Tableau de bord des revenus et des coûts d'IA par plan, dans le back-office | piloter la marge | P1 | M |
| 9.4 | Codes promotionnels, essai gratuit du plan Premium, tarif annuel | commercial | P2 | S |

---

## 10. Qualité logicielle et méthode

| # | Tâche | Pourquoi | Prio | Effort |
|---|---|---|---|---|
| 10.1 | Intégration continue active (voir 1.2) et branche principale protégée : fusion seulement par pull request, contrôles obligatoires (types, tests, build, bout en bout, image Docker), une relecture | ne rien casser en production | **P0** | S |
| 10.2 | Versions numérotées et journal des changements (fichier CHANGELOG), étiquettes de version qui déclenchent le déploiement en production | savoir ce qui tourne | P0 | S |
| 10.3 | Drapeaux de fonctionnalités (par espace ou par pourcentage) pour ouvrir une nouveauté progressivement | limiter l'impact d'un défaut | P1 | M |
| 10.4 | Tests de bout en bout rejoués sur la préproduction après chaque déploiement (parcours : inscription, génération avec un modèle bouchon, rendu, paiement de test, publication) | vérifier le déploiement lui-même | P1 | M |
| 10.5 | Tests de migration sur une copie anonymisée de la production avant chaque mise à jour du schéma | ne jamais casser des projets existants | P1 | S |
| 10.6 | Tests de non-régression visuelle des styles et du moteur (images de référence, phase 0 du plan du moteur) | la qualité des films ne doit pas se dégrader en silence | P1 | M |
| 10.7 | Dossier `docs/runbooks/`, fiches d'architecture des décisions (ADR), guide de contribution | transmettre et tenir dans la durée | P1 | S |

---

## 11. Le moteur d'animation

Le détail est dans [docs/moteur/plan.html](moteur/plan.html). Ce qui compte pour le lancement :

- **Avant la bêta ouverte (P1)** :
  - phase 0, fondations : format v2 et migration, tests visuels et de déterminisme ;
  - phase 1, voir et mesurer : relecture du mouvement, `measure.ts`, rapport de génération, flou de mouvement, 60 images/s.
- **Après l'ouverture (P2)** :
  - phase 2, fluidité ;
  - phase 3, personnages ;
  - phase 4, méthode Maelia ;
  - phase 5, motion design ;
  - phase 6, simulation, sorties et éditeur.

  Elles arrivent par versions successives, derrière des drapeaux de fonctionnalités (10.3).

---

## 12. Les étapes du lancement

### Étape A : déployable (2 à 3 semaines)

- Hébergement, domaine, HTTPS, trois environnements, secrets et limites de l'hébergement (3.1 à 3.3, 3.7, 3.11).
- Base et disque des médias sauvegardés, restauration testée (3.4, 3.5, et la partie P0 de 3.6).
- Disponibilité, journaux, métriques, erreurs, alertes (3.10, 4.1 à 4.4).
- Intégration continue active et branche protégée (1.2, 10.1, 10.2).
- Défauts connus 1.1 et 1.6.

**Sortie** : la préproduction tourne, se met à jour toute seule, et on est prévenu quand elle tombe.

### Étape B : bêta privée, sur invitation (3 à 4 semaines)

- **Sécurité** : SSRF, en-têtes, limites de débit, double authentification des gérants, audit des dépendances (2.1, 2.2, 2.5, 2.6, 2.9).
- **IA et coûts** : modèles de la plateforme, coûts, plafonds et plans (6.1 à 6.3), modération des entrées et des sorties (6.5), conservation des consignes (6.6).
- **Légal** : mentions, CGU, CGV, confidentialité, suppression et export du compte, conservation, sous-traitants, transparence IA, droit d'auteur, voix, TVA (5.1 à 5.14, sauf 5.15).
- **Produit** : accueil guidé, site public, support (7.1, 7.2, 7.4).
- **Communauté et paiement** : règles, contrôles, outils et astreinte de modération (8.1, 8.2, 8.4, 8.5), Stripe en production (9.1, 9.2).
- **Retours** : une centaine d'utilisateurs invités, retours recueillis, défauts corrigés.

**Sortie** : tous les P0 sont faits, sauf 2.3, 2.4 et 2.10, prévus pour l'étape C.

### Étape C : bêta ouverte, inscription libre (2 à 3 semaines)

- Vérification de l'e-mail, protection anti-robots, test d'intrusion corrigé (2.3, 2.4, 2.10).
- Tests de charge et capacité ajustée (4.7), page d'état (4.6), runbooks (4.8).
- Phases 0 et 1 du moteur : chaque film est mesuré et accompagné de son rapport (6.7).
- `SIGNUP=open`.

**Sortie** : service ouvert à tous, surveillé, avec des objectifs de service mesurés.

### Étape D : montée en charge et version 1.0

- Stockage objet et CDN (3.6), workers qui s'ajustent à la file (3.8), mises à jour sans interruption (3.9), plan de reprise (3.12).
- Rotation des clés (2.7), isolation de FFmpeg (2.8), double authentification des utilisateurs (2.6).
- Accessibilité (5.15), anglais (7.6), aide, e-mails, performances (7.3, 7.5, 7.7).
- Moteur : phases 2 à 6, par versions successives.

---

## Liste de contrôle du jour d'ouverture

- [ ] Tous les P0 fermés ; test d'intrusion sans faille critique ou haute ouverte.
- [ ] Restauration de sauvegarde réussie depuis moins de 30 jours.
- [ ] Alertes reçues par au moins deux personnes ; astreinte définie pour la première semaine.
- [ ] Mentions, CGU, CGV, confidentialité, règles de la communauté et page d'accessibilité en ligne et liées depuis chaque page.
- [ ] Stripe en production, testé avec une vraie carte (puis remboursé).
- [ ] Plafonds de coût d'IA actifs, et alerte de coût testée.
- [ ] Page d'état publique en ligne.
- [ ] Plan de retour arrière écrit : version précédente redéployable en moins de 15 minutes, migrations compatibles.
- [ ] Support joignable, et réponses types prêtes.
