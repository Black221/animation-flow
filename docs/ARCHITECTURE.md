# Architecture

## Principe : séparer le « quoi » du « comment »

```
projet JSON ──► moteur ──► primitives (écran) ──► pack de style ──► pixels
(schema)        (engine)   chemins, textes,       (styles)          canvas du navigateur,
  ▲             + bibliothèque (library)          halos, dégradés                   ou Node sur un serveur
  │
éditeur web · modèle d'IA · modèles joints au prompt
```

- Le **projet** décrit la scène : décor, personnages, accessoires, textes, caméra, narration. Aucune couleur de pinceau ni
  aucun code de dessin.
- La **bibliothèque** transforme un élément (par exemple le personnage `person` en pose `wave` avec l'expression `happy`) en
  **primitives** : des chemins remplis ou tracés, des textes, des halos, des dégradés, en coordonnées locales.
- Le **moteur** place ces primitives avec la transformation de l'élément et la caméra, supprime ce qui est hors champ, et
  trie de l'arrière vers l'avant. Il ne dépend que du projet et de l'instant `t` : les images peuvent se calculer dans
  n'importe quel ordre, en parallèle, et donnent toujours le même résultat.
- Un **pack de style** dessine les primitives. `flat` : aplats et contours nets. `watercolor` : lavis superposés, encre qui
  tremble, grain du papier. `papercut` : chaque forme est une pièce de papier (bord coupé irrégulier, ombre portée
  `shadowBlur`, couleur crème), le ciel des bandes de papier ondulées, les pièces qui bougent recoupées 4 fois par
  seconde (la saccade de l'image par image), une fibre de kraft multipliée par-dessus. `sketch` : teinte de crayon de
  couleur décalée du trait, hachures découpées à la forme (angle et pas tirés de l'id : un dessin garde sa main),
  contour graphite repris deux fois, ombres en hachures croisées. `comic` : encrage noir épais, couleurs saturées,
  trames de points (un motif en tuile, pas des milliers de cercles) sur le côté ombré des grandes formes du décor et
  dans les ombres, lettrage cerné, case noire. `neon` : silhouettes sombres, contours en tubes (halo `shadowBlur` puis
  cœur clair), détails allumés pour que les visages se lisent, ciel de nuit étoilé, lignes de balayage. Tous n'utilisent
  que Canvas 2D : même rendu dans l'éditeur et sur un serveur, sans GPU ; tous sont déterministes et peignent le décor une
  fois par scène. Chaque pack donne aussi sa vitesse (`speed`), ses couleurs (`swatch`) et une consigne pour l'IA
  (`hint`, reprise dans `packages/ai/src/prompts.ts`).

## Le format d'animation (`packages/schema`)

```jsonc
{
  "schemaVersion": 1, "title": "…", "fps": 24, "width": 1920, "height": 1080, "style": "watercolor",
  "cast": { "awa": { "kind": "person", "name": "Awa", "params": { "skin": "#8A5A3C", "cap": "#1F3A5F" } } },
  "scenes": [{
    "id": "s1", "title": "…", "duration": 30,
    "decor": { "kind": "dawn-field", "params": { "sun": "#F2C14E" } },
    "narration": [{ "id": "l1", "text": "Voici Awa.", "holdAfter": 0.6, "duration": 0.84, "audio": { "asset": "3f…", "textHash": "9c2a41d0" } }],
    "music": { "mood": "curious", "gain": 0 },
    "sfx": [{ "t": { "line": "l1", "edge": "end", "offset": -0.6 }, "kind": "whoosh", "pan": 0.6 }],
    "camera": [{ "t": 0, "zoom": 1 }, { "t": { "line": "l1", "edge": "end" }, "ease": "inOut", "zoom": 1.25, "x": 860, "y": 600 }],
    "elements": [{
      "id": "awa", "type": "character", "ref": "awa", "layer": 5,
      "keys": [
        { "t": 0, "x": -150, "y": 900, "pose": "walk" },
        { "t": { "line": "l1", "edge": "end", "offset": 0.4 }, "ease": "out", "x": 820 },
        { "t": { "line": "l1", "edge": "end", "offset": 0.5 }, "pose": "wave", "expression": "happy" }
      ]
    }]
  }]
}
```

- **Temps** : des secondes depuis le début de la scène, ou un point d'une réplique (`{ line, edge, offset }`). Quand la voix
  est enregistrée, les durées mesurées remplacent les estimations et chaque action suit ses mots sans retouche.
- **Images clés** : les nombres (`x`, `y`, `scale`, `rotation`, `opacity`, `zoom`) s'interpolent entre les deux clés qui les
  fixent, avec l'accélération (`ease`) de la seconde ; `pose`, `expression`, `facing` et `text` sont tenus depuis leur clé.
  Une propriété ne s'interpole qu'entre les clés qui la fixent : une clé peut changer la pose sans déplacer le personnage.
- **Horloge** : une réplique dure sa durée mesurée, ou 14,5 caractères par seconde tant qu'il n'y a pas de voix ; 0,3 s
  avant la première, 0,45 s entre deux, 0,6 s après la dernière, plus `holdAfter`. Une scène dure au moins sa voix.
- **Validation** : au-delà des types, le schéma refuse les identifiants en double, les répliques et personnages inconnus.
  `checkAgainstLibrary` signale ensuite ce que la bibliothèque ne connaît pas (décor, accessoire, pose, expression).
  Les erreurs ont un chemin lisible, pour l'éditeur comme pour renvoyer une correction à un modèle.
- `projectJsonSchema()` exporte le schéma JSON, utilisé pour contraindre la sortie des modèles qui l'acceptent.

- **Voix** : `line.audio` désigne l'enregistrement et l'empreinte du texte qu'il dit (`textHash`). Si le texte change,
  l'enregistrement n'est plus « à jour » (`voiceIsCurrent`) : il est ignoré au mixage et signalé dans l'éditeur.
  `cast.<id>.voice` donne une voix propre à un personnage.

## Son (`packages/audio`)

```
répliques enregistrées ─┐
musique (ambiance/scène)├─► mixSoundtrack() ─► −16 LUFS, crêtes −2 dBTP ───► aperçu (Web Worker + Web Audio)
bruitages (sfx/scène) ──┘                                                   └► rendu (WAV → AAC dans le MP4)
```

- Les voix sont stockées à −18 LUFS (`normalizeVoice`, à l'enregistrement) ; la musique est mesurée et placée à
  −26 LUFS quelle que soit l'ambiance, puis baissée de 8 dB sous la voix (suiveur d'enveloppe) ; les bruitages gardent
  leur niveau de synthèse. Le tout est enfin ramené à −16 LUFS intégrés (BS.1770 : pondération K, blocs de 400 ms,
  portes à −70 LUFS et −10 LU) avec un limiteur à anticipation sur les crêtes réelles (suréchantillonnage ×4).
- La musique est une **partition** (`project.score`) : des morceaux (tempo, tonalité, mode, grille d'accords en chiffres
  romains, parties jouées par 11 instruments et 7 percussions sur des motifs de 16 pas, mélodies en degrés de la gamme),
  composés pour le film par le modèle de la tâche « Musique et bruitages ». `scene.music.mood` nomme un morceau de la
  partition, ou une des six ambiances intégrées (elles-mêmes des morceaux), ou `none`. Fondus d'une scène à l'autre,
  réverbération ; tout est déterministe (aléatoire à graine).
- Les bruitages sont des **recettes** (`project.sounds`) : des couches d'onde ou de bruit qui glissent en hauteur,
  filtrées, avec enveloppe, vibrato et répétitions, conçues pour le film ; les noms intégrés (`pop`, `whoosh`…) restent.

## Décors et plates

Un décor produit une partie **fixe** (peinte une seule fois par scène, gardée en mémoire comme une « plate » à la
résolution du plus fort zoom de la scène) et une partie **vivante** (nuages, étoiles qui scintillent) redessinée à chaque image.
La caméra ne fait que déplacer la plate. C'est ce qui rend l'aquarelle rapide : environ 10 ms par image en 960 px, dans Node.

Pour un décor dessiné (`project.assets`), la plate s'arrête à la première partie qui bouge : elle et tout ce qui est
dessiné après elle sont redessinés à chaque image, pour que l'ordre du dessin tienne (une nappe devant des rayons qui
tournent). Un décor peut aussi porter une **image** peinte par un modèle d'images (`asset.image`, fichier dans
`IMAGES_DIR/<espace>/`) : elle couvre le décor, dont le dessin reste dessous, montré tant qu'elle n'est pas chargée
(aperçu : liens signés ; rendu serveur : fichiers décodés avant la première image).

## Génération par IA (`packages/ai`, `apps/api/src/routes/generations.ts`)

```
texte ─► storyboard ─► relecture ─► dessins ─────────────► musique et ─► scène par scène ─► projet
         (distribution,  (interface)  chacun : JSON vérifié,  bruitages     avec ces dessins,
          accessoires,                rendu en PNG, montré    (partition,   ces morceaux,
          décors, sons)               au modèle qui le relit  recettes)     ces bruitages
                                      et corrige (2 tours) ;
                                      décors peints en image
                                      si un modèle d'images
                                      est choisi
      à chaque étape : erreurs renvoyées au modèle (2 fois au plus), puis version de secours
```

Rien ne vient d'un catalogue fixe : le storyboard dit ce que le film demande, en mots, et chaque chose est faite pour
lui. Un dessin (`Asset`) est un arbre de parties avec pivots ; les poses font tourner, balancer, rebondir ou tourner en
continu chaque partie, les expressions choisissent une variante par groupe (yeux, bouche). `checkAsset` vérifie la
taille, les pieds au sol, les poses (`idle`, `walk`, `talk`, `point`, `wave`) et expressions (`neutral`, `happy`,
`sad`, `surprised`) dont les scènes ont besoin. La relecture visuelle passe par `renderStill` (le même moteur que
le rendu) ; un modèle qui ne lit pas les images est détecté à sa première réponse 4xx et la relecture s'arrête pour
le reste de la génération.

- `complete()` (`packages/providers`) parle à chaque fournisseur de modèles de texte (images comprises, au format de
  chacun) ; `generateImage()` aux modèles d'images (OpenAI, Gemini, Imagen). `modelFor()` lie une tâche (storyboard,
  scènes, dessins, musique ; ces deux dernières retombent sur le modèle des scènes) à sa clé déchiffrée le temps d'une
  génération ; `imageModel()` rend le modèle de « Décors en images », ou rien (tâche facultative).
- Une génération tourne dans le processus de l'API (les appels sont réseau) ; son état, ses tokens et chaque appel
  (avec les problèmes trouvés) sont en base (`generations`). Un redémarrage marque les générations en cours comme
  interrompues ; on peut relancer le storyboard ou les scènes.
- La scène de secours (`fallbackScene`) : le décor, l'ambiance et la narration du storyboard, les personnages qui
  parlent debout, le titre. Le projet final est donc toujours valide.
- Retouche (`editScene`) : ce que le modèle omet (narration, décor…) reste tel quel ; une réplique inchangée garde
  son enregistrement et sa durée mesurée.

## Communauté (`apps/api/src/routes/community.ts`)

```
projet (espace A) ──publier──► publication : copie figée du projet enregistré + ses médias (COMMUNITY_DIR/<id>/)
                                  │  galerie, page, médias et miniature : publics (sans compte)
                                  │  j'aime (1 par personne), vues (1 par visiteur et par heure)
                                  ▼
                   remixer ──► nouveau projet (espace B), médias copiés dans l'espace B, projects.remix_of
                                  │  publié à son tour : publications.remix_of ; l'original compte ses remix
```

- La publication est une copie : l'auteur continue de modifier son projet, et republie quand il veut (même
  publication, copie remplacée). La retirer ne touche ni le projet ni les remix déjà faits.
- Licences : CC BY, CC BY-SA, CC0 (toutes permettent le remix) ; le remix d'une œuvre BY-SA reste BY-SA.
- Seuls les noms des personnes sont montrés, jamais leur e-mail ; les clés, commentaires et générations ne sont
  jamais publiés. Supprimer un espace supprime ses publications et leurs médias.

## Plans, quotas et paiements (`apps/api/src/plans.ts`, `billing.ts`, `routes/plans.ts`, `routes/admin.ts`)

- Un plan par **espace** (`workspaces.plan` : `free`, `premium`, `pro`), ses limites dans `PLANS` ;
  l'administrateur peut en surcharger une partie pour un espace (`workspaces.quotas`, JSON : un nombre, `null` pour
  « illimité », absent pour « celui du plan »).
- Deux sortes de compteurs. Ce qui existe se mesure : projets, membres (invitations en attente comprises), stockage
  (voix et décors sur disque, mesurés au plus toutes les 30 s, plus les vidéos rendues). Ce que le mois consomme
  s'inscrit dans `usage_events` (`generations`, `aiActions`, `renderMinutes`), avec une référence au travail : un
  rendu ou une génération qui échoue, ou qu'on annule, efface sa ligne (la file de rendu le fait elle-même).
- `quota.ensure(ws, metric, n)` avant chaque création (projet, remix, génération, retouche IA, rendu, invitation,
  voix, décor peint), `quota.width` pour la largeur, `quota.feature` pour les décors peints. Une limite atteinte
  lève `QuotaError`, que le serveur transforme en **402** `{ error, quota: { metric, plan, limit, used } }` ; le
  navigateur ouvre alors un seul dialogue (`plan.tsx`) quel que soit l'endroit. `PLANS=off` : tout est illimité.
- Les rendus du plan Pro passent devant (`renders.priority`, `ORDER BY priority DESC, created_at`).
- **Stripe** sans SDK (`billing.ts`) : Checkout en mode abonnement (`metadata.workspace_id` et `plan` sur la session et
  sur l'abonnement), espace client, et le webhook. Celui-ci lit le corps brut (son propre `scope` Fastify), vérifie
  `Stripe-Signature`, écrit l'identifiant de l'événement dans `billing_events` (une seule fois ; en cas d'erreur, la
  ligne est retirée pour que Stripe réessaie) puis applique : `checkout.session.completed` → le plan payé ;
  `customer.subscription.updated` → le plan du prix (actif, essai) ou seulement l'état (retard de paiement) ;
  `deleted`, `canceled`, `unpaid` → retour au plan Gratuit. Le serveur ne décide jamais seul qu'un plan est payé.
- Administration de la plateforme : les **gérants**, des comptes à part (`staff`, `staff_sessions`,
  `staff_invitations`), jamais des utilisateurs. Elle vit dans le **back-office**, un serveur à part
  (`apps/api/src/admin/server.ts`, `routes.ts`) et une application à part (`apps/admin`) : cookie `af_admin`, en-tête
  CSRF à part, journal `admin_audit` de chaque écriture (`admin_id` → `staff`). Le premier gérant : `POST /api/setup`
  avec le secret (`ADMIN_SETUP_TOKEN`, ou celui écrit dans `DATA_DIR/admin-setup-token`, supprimé ensuite) ; les
  suivants : une invitation (`/join/<jeton>`, seul son hachage est gardé, trois jours). Côté application, les droits
  s'arrêtent à l'espace (propriétaire, administrateur, éditeur, lecteur) ; l'API de l'application n'a aucune route de
  la plateforme. La migration 11 a changé les anciens administrateurs de la plateforme en gérants (mêmes identifiants). `main.ts` démarre les deux serveurs sur la même base. Suspension : `users.suspended_at` (les sessions sont supprimées, `sessionUser` ignore un compte
  suspendu). Modération : `reports` (un signalement ouvert par personne et par film) et `publications.hidden_at`.

## Paquet partagé (`packages/ui`)

Ce que l'application et le back-office ont en commun : icônes, dialogues, confirmations et notifications
(`UIProvider`, `useUI`), menus, thème clair / sombre / automatique, ce qu'est un plan (limites, jauge, badge) et la
feuille de base `@af/ui/base.css` (jetons de design, contrôles, dialogues, jauges). Chaque application y ajoute sa
propre feuille.

## Interface (`apps/web`)

- Trois mises en page : l'application (barre latérale : recherche dans la communauté, créer, mon espace, compte ;
  un tiroir sur téléphone), le plein écran (éditeur, génération : leur propre barre, pas de navigation globale),
  la connexion.
- `components/ui.tsx` : dialogues (`<dialog>` modaux), confirmations et questions attendues (`useUI().confirm`,
  `prompt`, `info`), notifications (`toast`), menus. Sur téléphone, les dialogues montent du bas ; sur tablette en paysage, l'éditeur passe en deux colonnes (scènes en bandeau, aperçu, inspecteur).
- `components/Motion.tsx` et la fin de `styles.css` : l'interface parle le langage de l'animation, sans film de
  démonstration. Les options de l'IA sont les pistes d'une frise (la durée sur une règle, avec sa tête de lecture) ;
  la suite (storyboard, dessins, voix et musique, animation, film) est une frise d'images clés que parcourt la tête de
  lecture au lancement. Chaque carte montre la frise de son film (une plage par scène : `scenes`, la durée de chaque
  scène, dans les listes de projets et de publications) et la parcourt en jouant au survol, dans le cadre de la
  caméra. La connexion montre un storyboard (une image par scène : `/api/templates/:nom/thumbnail.png?scene=n`,
  public). Chargement : une balle qui rebondit (écrasement, étirement) ; états vides : une pelure d'oignon ; la
  barre latérale marque la page comme une tête de lecture ; le défilement fait avancer une tête de lecture en haut de
  la page. Les mouvements suivent les principes de l'animation (écrasement à l'appui, dépassement à l'arrivée,
  cartes en cascade, coupe entre les pages) ; tout s'arrête avec `prefers-reduced-motion`.
- `media.ts` : ce qui est volontairement laissé de côté sur petit écran (`PHONE`) ou tactile (`TOUCH`) : sur téléphone,
  l'inspecteur ne garde que Scène, Voix et Commentaires, l'export des sous-titres disparaît ; au doigt, pas de
  raccourcis clavier ; classes `hide-phone` et `hide-tablet` pour les colonnes secondaires des tableaux.

## Modèles pour l'IA (`apps/api/src/routes/uploads.ts`, `apps/web/src/components/ModelsForAI.tsx`, `textfile.ts`)

Tout fichier se joint au prompt et sert de **modèle** : l'IA s'en inspire, rien n'entre tel quel dans le projet.

- `POST /api/uploads/image` prend l'image comme corps de la requête (analyseur de corps brut limité à ces routes,
  `bodyLimit` par route). Le type vient des premiers octets (`pictureType`), jamais de l'en-tête. `normalizeUpload`
  (`@napi-rs/canvas`) redessine, détecte la transparence et la couleur moyenne, écrit
  `IMAGES_DIR/<espace>/<id>.png|.jpg` ; `imageFile` trouve l'un ou l'autre.
- `POST /api/uploads/audio` : `decodeUpload` écrit une copie temporaire, lance FFmpeg avec `-f <format>
  -protocol_whitelist file`, lit du PCM mono 11 025 Hz ; `musicFeatures` (`packages/audio/src/analyse.ts`) en tire le
  tempo (autocorrélation de l'enveloppe des attaques, fenêtres de 46 ms tous les 128 échantillons, lue à des retards
  fractionnaires et sommée sur les premiers multiples du temps, avec une préférence douce autour de 120 BPM), la
  netteté du rythme (contraste de ce peigne), l'énergie (RMS), la brillance (passages par zéro) et la tonalité probable
  (chroma par Goertzel de do3 à si5, corrélé aux profils de Krumhansl) ; `describeMusic` le dit en une phrase. Rien
  n'est stocké.
- Une génération reçoit `references` : `{ id, kind: character | prop | decor | style | music | project, name,
  description?, asset?, summary? }` (une image pour les quatre premiers, une analyse pour une musique ou un projet ;
  dix au plus, ids uniques, images de l'espace). `modelPicture` (`routes/images.ts`) relit l'image en PNG de 1024 px au
  plus pour les modèles qui voient.
- `referencesBrief` (`packages/ai/src/prompts.ts`) les décrit au storyboard, images numérotées et jointes au premier
  message (`ask(…, images)`) : un personnage, un objet ou un décor doit y figurer sous son id, décrit d'après son image
  (sinon le modèle corrige) ; une ambiance donne palette et humeur ; une musique, l'esprit de la musique de chaque
  scène ; un projet, un plan à reprendre. `drawOne` joint l'image du modèle à la demande de dessin (`MODEL_NOTE` :
  redessiner fidèlement en vectoriel articulé, jamais décalquer) et la relecture reçoit le modèle et le dessin côte à
  côte. `composeScore` reçoit les musiques modèles (« dans son esprit, jamais une copie »).
- Dans le navigateur, `ModelsForAI` trie ce qui est joint ou déposé : une image ouvre un dialogue (ce qu'elle montre,
  nom, précisions) puis s'envoie ; une musique est écoutée par le serveur ; un `.json` donne son plan (`outline` :
  titre, style, personnages, scènes et répliques, 4 000 caractères au plus) ; le reste est lu comme un texte
  (`readTextFile` : DOCX et ODT depuis le XML de leur zip avec `DecompressionStream`, PDF avec pdf.js chargé à la
  demande, SRT/VTT sans numéros ni temps) et remplit la zone du brief.
- `GET /api/projects/:id/export` : `{ format: 'animation-flow', version: 1, project, media: { images, sounds } }`
  (base64). Il n'y a pas d'import direct : un projet exporté se joint au prompt comme modèle.
- Le format garde la forme `image` d'un dessin (décors peints par un modèle d'images) et, pour les projets plus
  anciens, `soundtrack` (une musique de fichier sous tout le film) et `pictureAsset` (`packages/schema/src/picture.ts` :
  une image qui joue, `flip: false`, jamais retournée en miroir) ; `pictureAssetsOf` et `soundAssetsOf` disent quels
  médias un projet utilise (rendu, vignettes, aperçu, publication, export).
- Recadrage : les titres d'une même ligne (boîtes qui se recouvrent verticalement) sont replacés ensemble, comme un
  bloc ; en vertical, les sous-titres incrustés passent au milieu de l'image (les personnages occupent le bas), sur un
  fond sombre translucide.

## Rendu vidéo (`packages/render`, `apps/api/src/render`)

```
POST /api/projects/:id/renders ──► table renders (file d'attente dans PostgreSQL)
                                        │  claim : UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)
                                        ▼
                             worker (dans l'API, ou ROLE=worker)
                                        │  renderVideo() : N blocs d'images en parallèle (worker_threads)
                                        │  chaque bloc : moteur → style → canvas → pixels RGBA → FFmpeg (H.264)
                                        ▼
                             concat sans réencodage + piste de sous-titres → RENDERS_DIR/<id>.mp4 | .webm | .gif
```

- **Formats** : `format` MP4 (H.264 + AAC, `mov_text`), WebM (blocs en VP9 `-row-mt`, Opus, sous-titres WebVTT) ou GIF
  (blocs en H.264 presque sans perte, puis une palette pour tout le film `palettegen stats_mode=diff` et `paletteuse`
  tramé, 15 images/s, en boucle ; ni son ni piste). L'API limite le GIF à 540 lignes et 60 s. La taille se donne en
  lignes (360 à 1080) ; le plan la limite par la largeur 16:9 équivalente (`maxWidth`), la même netteté pour tous les
  cadres. `width` (640 à 1920) reste accepté.
- **Recadrage** (`packages/engine/src/reframe.ts`) : un film composé en 16:9 livré en 9:16, 1:1 ou 4:5 garde, image par
  image, une fenêtre aussi haute que l'image. `evaluate` donne pour chaque image les boîtes des personnages et
  accessoires du monde (`subjects`), qui parle (`speakerId`), et marque les primitives des éléments `screen`
  (`overlay`). `planFraming` échantillonne le film 6 fois par seconde, vise le groupe de personnages s'il tient dans la
  fenêtre, sinon leur moyenne pondérée (celui qui parle compte triple), puis lisse la trajectoire dans les deux sens
  (sans retard ni tremblement, τ = 0,7 s) scène par scène : une nouvelle scène peut commencer ailleurs, comme un
  raccord. Calculé sur tout le film, le chemin est le même dans chaque bloc de rendu. `reframe` décale le monde et
  replace chaque titre en entier dans la fenêtre (même place relative, réduit s'il ne tient plus). `fit` montre tout le
  film sur une copie de lui-même floutée (réduite puis agrandie : identique partout) et assombrie
  (`packages/styles/src/output.ts`). L'aperçu de l'éditeur utilise le même code.
- **Sous-titres incrustés** (`burn`) : la réplique dessinée dans l'image, dimensionnée sur la largeur ; en vertical plus
  haut (80 % de la hauteur), hors des boutons des applications ; en `fit`, dans la bande sous l'image.

- Le rendu utilise la **version enregistrée** au moment de la demande (`project_versions`) : on peut continuer à éditer.
- Les images étant déterministes, découper en blocs ne change rien au résultat.
- Le worker envoie progression et battement de cœur toutes les 0,7 s ; il y lit aussi une éventuelle annulation.
  Un rendu sans battement depuis 90 s repart dans la file, et échoue après deux essais. À l'arrêt, un worker rend son
  travail en cours à la file.
- La vidéo est servie par un lien signé (HMAC, valable une heure, clé dérivée de `APP_ENCRYPTION_KEY`), car une balise
  `<video>` ne peut pas envoyer d'en-tête d'authentification. Les requêtes partielles (`Range`) sont gérées pour la lecture.

## Ajouter…

- **un style** : un objet `StylePack` (`packages/styles/src/types.ts`) qui sait dessiner les primitives (avec `speed`, `swatch` et `hint`), puis l'ajouter à `stylePacks` (et sa consigne à `STYLE_BRIEF`, `packages/ai/src/prompts.ts`). Les tests de `packages/styles` vérifient pour chaque pack une image variée, le déterminisme et une seule peinture du décor par scène.
- **un personnage, un accessoire, un décor** : d'ordinaire, rien à coder : c'est un dessin du projet (`project.assets`),
  fait par le modèle ou dans l'onglet « Dessins ». `packages/ai/src/examples.ts` montre un exemple de chaque sorte, et
  le modèle de projet « Pizza Time » (`apps/api/src/examples`) un film entier dessiné pour son histoire. Les fonctions
  de `packages/library` (déclarées dans `registry`, décrites dans `catalog`) restent pour les projets plus anciens.
- **un fournisseur de modèles** : une entrée dans `PROVIDERS` (`packages/providers`) et, si son API diffère, sa façon de lister les modèles.

## Sorties réseau et en-têtes (`apps/api/src/net`)

- **Adresses données par les utilisateurs** (`safe-fetch.ts`, ADR `docs/adr/0001-…`) : tous les appels aux fournisseurs
  (test d'une clé, modèles de texte, voix, images) passent par `safeFetch`, que `buildServer` donne à chaque route ;
  `packages/providers` n'a plus de `fetch` par défaut. Pour chaque saut : résolution une fois, refus si une des
  adresses est privée, locale, de lien local, réservée ou de métadonnées (IPv4 dans IPv6 comprise), puis connexion
  à l'adresse vérifiée (`lookup` épinglé : pas de seconde résolution, SNI et certificat suivent le nom).
  Redirections suivies à la main (5 au plus, jamais de https vers http, clés retirées en changeant d'origine), délai
  et taille plafonnés (32 Mio, après décompression). `ALLOW_PRIVATE_PROVIDERS=true` lève la seule politique
  d'adresses. Les erreurs (`BlockedAddressError`, `ResponseTooLargeError`) deviennent des messages en français dans
  `packages/providers`, reconnues à leur nom.
- **En-têtes** (`headers.ts`) : pages et fichiers du site avec une CSP stricte (`'self'` seulement, `blob:` et `data:`
  pour les images et les sons faits dans la page, aucun script en ligne : le thème est lu par `public/theme.js`),
  réponses de l'API avec `default-src 'none'`, partout `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`
  (`same-origin` ; `no-referrer` au back-office), `Permissions-Policy`, et HSTS en HTTPS. Dans le navigateur, zod
  vérifie sans compiler (`jitless`, `packages/schema`) : sa sonde `new Function` serait refusée par la CSP. Les tests
  de bout en bout échouent sur toute violation de la CSP (`apps/web/e2e/fixtures.ts`).

## Comptes, espaces et rôles (`apps/api/src/auth`)

- Tables : `users`, `sessions` (empreinte du jeton), `workspaces`, `memberships` (rôle), `invitations` (empreinte du
  lien, rôle, expiration, adresse facultative). Projets, clés, choix des modèles et générations portent un
  `workspace_id` ; les rendus suivent leur projet ; les voix sont rangées dans `VOICES_DIR/<espace>/`.
- Chaque route déclare dans sa configuration ce qu'elle exige : `{ auth: 'public' }`, `{ auth: 'user' }` ou
  `{ role: 'viewer' | 'editor' | 'admin' | 'owner' }` (défaut : `viewer`, donc jamais ouverte par oubli). Un seul
  crochet (`installAuth`) lit la session, l'espace demandé (`x-workspace-id`, sinon le premier) et le rôle.
- Toute requête d'un espace filtre sur cet espace : un objet d'un autre espace est « introuvable » (404), sans
  révéler qu'il existe. Les liens signés (vidéos, voix) incluent l'identifiant de l'espace.
- Migration : les données d'avant les comptes vont dans un espace par défaut ; le premier compte en devient
  propriétaire ; les voix déjà enregistrées sont déplacées dans son dossier au démarrage.

## Édition en temps réel (`packages/schema/src/ops.ts`, `live.ts`, `apps/api/src/live`)

- **Opérations** : `diffJson(avant, après)` réduit une modification aux feuilles qui changent (`set`, `remove`) ;
  `applyOps` les rejoue sur une copie. Les tableaux dont les éléments ont un `id` (scènes, éléments, répliques)
  sont adressés par identifiant (`['scenes', { id: 's2' }, 'title']`) ; ajouter, retirer ou réordonner est une
  opération `list` (ordre voulu, éléments ajoutés, éléments retirés) qui garde les éléments ajoutés entre-temps par
  d'autres et l'état actuel de ceux qu'elle conserve. Les autres tableaux (clés d'animation, caméra) vont indice par
  indice, et sont remplacés entiers si leur longueur change. Chemins interdits (`__proto__`…) et opérations mal
  formées sont refusés.
- **Serveur** (`LiveHub`) : chaque processus de l'API tient une salle par projet où il a du monde ; la référence
  est dans la base, pour que plusieurs processus (répliques derrière un répartiteur de charge) servent le même
  projet sans affinité :
  - chaque modification acceptée entre dans le **journal** `live_ops`, numérotée par projet (`projects.live_seq`)
    sous le verrou de la ligne du projet : tous les processus voient les mêmes modifications dans le même ordre.
    Elle est vérifiée contre le projet à ce numéro (schéma complet ; place supprimée entre-temps) ; l'auteur reçoit
    `ack` ou `nack` + raison ;
  - `NOTIFY af_live` prévient les autres processus (qui lisent le journal), et porte la présence (renouvelée toutes
    les 15 s, oubliée après 45 s sans nouvelles : un processus arrêté disparaît), les enregistrements, les
    commentaires (un message trop gros pour une notification devient « rechargez ») et les connexions fermées
    (droits changés, projet supprimé). Une notification perdue (connexion d'écoute coupée, reprise au bout d'1 s)
    est rattrapée : chaque salle ouverte regarde où en est le journal toutes les 3 s ;
  - `projects.data` contient le projet jusqu'à `saved_seq`. Enregistrement 2 s après la dernière modification
    (10 s au plus), quand le dernier participant d'un processus part, et sur « Enregistrer » ; les enregistrements
    d'une séance mettent à jour la même version tant qu'elle reste la dernière, du même auteur et récente, jamais une
    version que la salle n'a pas écrite (création, enregistrement par l'API). Ce qu'un processus arrêté n'a pas
    enregistré reste dans le journal et l'est à la prochaine ouverture du projet. Le journal garde 10 minutes les
    modifications déjà enregistrées (un processus plus en retard se resynchronise sur la base) ;
  - un `PUT` par l'API, sous le même verrou, transforme d'abord en version ce que le journal a de non enregistré
    (la comparaison avec `baseVersion` porte donc sur la vraie dernière version), puis s'inscrit au journal comme
    `reset` : tout le monde, dans tous les processus, repart de lui.
- **Migrations** : un verrou consultatif PostgreSQL les fait passer une à une quand plusieurs processus démarrent
  ensemble.
- **Déploiement à plusieurs processus** : `docker-compose.cluster.yml` met nginx (`deploy/nginx.conf` : WebSocket,
  `Host` transmis, connexions longues, répliques suivies par le DNS de Docker, 64 Mo sur `/api/uploads/` et 10 Mo
  ailleurs ; une réplique arrêtée ou sans base, qui répond 502 ou 503, laisse la requête à une autre ; `/api/ready`
  réservée au réseau interne. nginx ne sonde pas lui-même : c'est le healthcheck de Docker qui interroge `/api/ready`) devant `--scale app=N`, avec
  `TRUST_PROXY=true` pour que l'API voie l'adresse du client. Vérifié dans Docker avec deux répliques, un worker et
  quatre navigateurs.
- **Client** (`LiveDoc`, partagé par l'éditeur et les tests) : il applique tout de suite ce que l'utilisateur tape,
  le garde « en attente » jusqu'à l'accusé, et rejoue les modifications en attente par-dessus celles des autres :
  tout le monde converge vers l'ordre du serveur (vérifié sur des entrelacements aléatoires). Après une
  reconnexion, ce qui n'avait pas été accusé est rejoué sur le projet actuel.
- **Sécurité** : `GET /api/projects/:id/live?ws=<espace>` passe par le même contrôle (session, espace, rôle
  lecteur au moins) ; l'origine de la page doit être le serveur lui-même ; un lecteur reçoit mais ne peut rien
  envoyer ; messages de 4 Mo au plus. Quand le rôle d'un membre change ou qu'il quitte l'espace, ses connexions
  se ferment (code 4001) et l'éditeur se reconnecte avec ses nouveaux droits ; un projet supprimé ferme la salle.
- **Vérifié** : deux serveurs sur une même base (tests d'API, sur PGlite et sur PostgreSQL, coupure de l'écoute
  comprise) et deux processus réels avec un navigateur sur chacun (`pnpm --filter @af/web e2e:cluster`, avec
  `CLUSTER_DATABASE_URL` vers une base jetable).

## Commentaires (`apps/api/src/routes/comments.ts`)

- Table `comments` : un fil (`parent_id` nul) ou une réponse ; épinglé à une scène par son identifiant (il suit la
  scène quand on réordonne), éventuellement à un élément et à un instant `t` (secondes depuis le début de la scène).
  Une réponse prend la place de son fil ; on ne répond pas à une réponse ; on résout un fil entier.
- Droits : tout membre commente ; l'auteur modifie son texte ; l'auteur ou un éditeur résout et rouvre ; l'auteur ou
  un administrateur supprime (les réponses partent avec leur fil). Un commentaire d'un autre espace est introuvable.
- Chaque changement est envoyé aux personnes qui ont le projet ouvert (événement `comments` de la salle en direct).
  Une scène supprimée garde ses commentaires, affichés « (supprimée) ».

## E-mail (`apps/api/src/mail.ts`)

- Transport : `SMTP_URL` est lu en options explicites (`smtpOptions` : hôte, port, `smtps` = TLS dès la connexion,
  identifiants décodés, options nodemailer en paramètres). Vérifié contre un vrai serveur SMTP (`smtp-server`) :
  STARTTLS et TLS implicite avec authentification, certificat non vérifiable refusé, mot de passe refusé signalé.
  `node dist/main.js --mail-test <adresse>` envoie un message de test avec les réglages de l'environnement.
- Facultatif : sans `SMTP_URL`, rien ne part (et `GET /api/auth/me` répond `mail: false`, l'interface cache ce qui
  en dépend). Avec, un transport nodemailer ; `MAIL_FROM` et `APP_URL` sont exigés au démarrage.
- Messages : invitation (qui invite, l'espace, le rôle, le lien, sa durée) et mot de passe oublié ; texte et HTML.
- Réinitialisation : table `password_resets` (empreinte du jeton, 1 heure, usage unique, un seul lien vivant par
  compte). `POST /api/auth/forgot` répond tout de suite et pareil pour une adresse inconnue, l'envoi se fait ensuite
  (ni le contenu ni le délai de la réponse ne trahissent l'existence d'un compte). Le changement ferme toutes les
  sessions et les connexions en direct, puis ouvre une session neuve.
- Les liens partent d'`APP_URL`, jamais de l'en-tête `Host`. Un échec d'envoi d'invitation est dit à
  l'administrateur (le lien reste affiché) ; un échec d'envoi de réinitialisation est journalisé, sans l'adresse du
  serveur ni ses identifiants.

## API (`apps/api`)

| route | rôle |
|---|---|
| `GET /api/health` | vie (sans compte) : `ok`, `version`, `commit` |
| `GET /api/ready` | disponibilité (sans compte) : base, écriture dans `DATA_DIR`, FFmpeg (vérifié une fois par minute au plus) ; 503 si l'un manque (`apps/api/src/ready.ts`). Toute requête qui trouve la base injoignable répond aussi 503 ; une connexion que la base ferme ne fait pas tomber le processus |
| `GET /api/auth/me`, `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `PATCH /api/auth/me` | compte : état, inscription, connexion, déconnexion, nom et mot de passe |
| `GET /api/invitations/:token`, `POST /api/invitations/:token/accept` | invitation : ce qu'elle donne ; l'accepter une fois connecté |
| `POST /api/auth/forgot`, `GET/POST /api/auth/reset/:token` | mot de passe oublié (e-mail configuré) : demander un lien ; voir le compte du lien ; choisir le nouveau mot de passe |
| `GET /api/workspaces`, `POST /api/workspaces` | mes espaces ; en créer un |
| `GET/PATCH/DELETE /api/workspace` | l'espace courant : membres et invitations, renommer, supprimer (propriétaire, nom à retaper) |
| `POST /api/workspace/invitations`, `DELETE /api/workspace/invitations/:id` | créer un lien d'invitation (affiché une fois ; `send: true` l'envoie aussi à `email`), le révoquer |
| `PATCH/DELETE /api/workspace/members/:userId` | changer un rôle, transmettre la propriété ; retirer un membre, partir |
| `GET /api/library`, `GET /api/schema` | bibliothèque, styles, modèles de projet ; schéma JSON du format |
| `GET/POST /api/projects`, `GET/PUT/DELETE /api/projects/:id` | projets ; `PUT` exige `baseVersion` (sinon 409 avec la version actuelle) et valide (422 avec les erreurs) |
| `GET /api/projects/:id/versions`, `GET /api/projects/:id/subtitles.srt` | historique ; sous-titres |
| `GET /api/projects/:id/live?ws=` (WebSocket) | édition en temps réel : reçoit `hello`, `ops`, `ack`/`nack`, `presence`, `saved`, `reset` ; envoie `ops`, `presence`, `save` |
| `GET/POST /api/projects/:id/comments`, `PATCH/DELETE /api/comments/:id` | commentaires : liste ; nouveau fil (`sceneId`, `elementId?`, `t?`, `body`) ou réponse (`parentId`, `body`) ; modifier (`body`), résoudre (`resolved`) ; supprimer |
| `GET /api/providers` | fournisseurs et tâches |
| `GET/POST /api/credentials`, `PATCH/DELETE /api/credentials/:id` | clés (jamais renvoyées) |
| `POST /api/credentials/:id/test` | teste la clé et liste les modèles |
| `GET /api/assignments`, `PUT /api/assignments/:task` | un modèle par tâche |
| `POST /api/projects/:id/renders`, `GET /api/projects/:id/renders` | demander un rendu (`style`, `width`, `quality`, `sceneId`, `subtitles`) ; liste |
| `GET /api/renders/:id`, `POST /api/renders/:id/cancel`, `DELETE /api/renders/:id` | suivre, annuler, supprimer |
| `GET /api/renders/:id/video?exp&sig` | la vidéo (lien signé, sans jeton ; `&download=1` pour télécharger) |
| `POST /api/generations`, `GET /api/generations[/:id]` | lancer une génération (`text`, `language`, `style`, `targetSeconds`, `instructions`, `review`) ; suivre |
| `PUT /api/generations/:id/storyboard`, `POST …/storyboard/retry`, `POST …/scenes`, `POST …/cancel` | corriger le storyboard, le refaire, écrire les scènes, annuler |
| `POST /api/ai/edit-scene` | retoucher une scène (`project`, `sceneIndex`, `instruction`) : la scène validée |
| `POST /api/voices` | dire une réplique (`text`, `voice?`, `language?`) avec la voix de la tâche « Narration » : `{ asset, textHash, duration, cached, url }` |
| `POST /api/voices/links`, `GET /api/voices/:asset.wav?exp&sig` | liens signés vers des enregistrements ; l'enregistrement |

Base de données : PostgreSQL (`pg`) ou PGlite embarqué, même SQL, migrations numérotées appliquées au démarrage,
chacune dans une transaction (sur une seule connexion : `Db.tx`).
