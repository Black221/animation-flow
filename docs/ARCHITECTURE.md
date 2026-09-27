# Architecture

## Principe : séparer le « quoi » du « comment »

```
projet JSON ──► moteur ──► primitives (écran) ──► pack de style ──► pixels
(schema)        (engine)   chemins, textes,       (styles)          canvas du navigateur,
  ▲             + bibliothèque (library)          halos, dégradés                   ou Node sur un serveur
  │
éditeur web · modèle d'IA · import
```

- Le **projet** décrit la scène : décor, personnages, accessoires, textes, caméra, narration. Aucune couleur de pinceau ni
  aucun code de dessin.
- La **bibliothèque** transforme un élément (par exemple le personnage `person` en pose `wave` avec l'expression `happy`) en
  **primitives** : des chemins remplis ou tracés, des textes, des halos, des dégradés, en coordonnées locales.
- Le **moteur** place ces primitives avec la transformation de l'élément et la caméra, supprime ce qui est hors champ, et
  trie de l'arrière vers l'avant. Il ne dépend que du projet et de l'instant `t` : les images peuvent se calculer dans
  n'importe quel ordre, en parallèle, et donnent toujours le même résultat.
- Un **pack de style** dessine les primitives. `flat` : aplats et contours nets. `watercolor` : lavis superposés, encre qui
  tremble, grain du papier. Les deux n'utilisent que Canvas 2D : même rendu dans l'éditeur et sur un serveur, sans GPU.

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
- La musique : une tonalité pour tout le film, un tempo, un mode et des instruments par ambiance (nappe, pizzicati,
  basse, cloches, grosse caisse et charleston discrets), des boucles d'accords de quatre mesures, des fondus d'une
  scène à l'autre, une réverbération. Tout est déterministe (aléatoire à graine).

## Décors et plates

Un décor produit une partie **fixe** (peinte une seule fois par scène, gardée en mémoire comme une « plate » à la
résolution du plus fort zoom de la scène) et une partie **vivante** (nuages, étoiles qui scintillent) redessinée à chaque image.
La caméra ne fait que déplacer la plate. C'est ce qui rend l'aquarelle rapide : environ 10 ms par image en 960 px, dans Node.

## Génération par IA (`packages/ai`, `apps/api/src/routes/generations.ts`)

```
texte ──► storyboard (Storyboard, zod) ──► relecture dans l'interface ──► scène par scène (Scene, zod + bibliothèque) ──► projet
              ▲  │                                                            ▲  │
              └──┘ erreurs renvoyées au modèle (2 fois au plus)               └──┘ idem, puis scène de secours
```

- `complete()` (`packages/providers`) parle à chaque fournisseur de modèles de texte ; `modelFor()` lie la tâche
  (storyboard ou scènes) à sa clé déchiffrée le temps d'une génération.
- Une génération tourne dans le processus de l'API (les appels sont réseau) ; son état, ses tokens et chaque appel
  (avec les problèmes trouvés) sont en base (`generations`). Un redémarrage marque les générations en cours comme
  interrompues ; on peut relancer le storyboard ou les scènes.
- La scène de secours (`fallbackScene`) : le décor, l'ambiance et la narration du storyboard, les personnages qui
  parlent debout, le titre. Le projet final est donc toujours valide.
- Retouche (`editScene`) : ce que le modèle omet (narration, décor…) reste tel quel ; une réplique inchangée garde
  son enregistrement et sa durée mesurée.

## Rendu vidéo (`packages/render`, `apps/api/src/render`)

```
POST /api/projects/:id/renders ──► table renders (file d'attente dans PostgreSQL)
                                        │  claim : UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)
                                        ▼
                             worker (dans l'API, ou ROLE=worker)
                                        │  renderVideo() : N blocs d'images en parallèle (worker_threads)
                                        │  chaque bloc : moteur → style → canvas → pixels RGBA → FFmpeg (H.264)
                                        ▼
                             concat sans réencodage + piste de sous-titres → RENDERS_DIR/<id>.mp4
```

- Le rendu utilise la **version enregistrée** au moment de la demande (`project_versions`) : on peut continuer à éditer.
- Les images étant déterministes, découper en blocs ne change rien au résultat.
- Le worker envoie progression et battement de cœur toutes les 0,7 s ; il y lit aussi une éventuelle annulation.
  Un rendu sans battement depuis 90 s repart dans la file, et échoue après deux essais. À l'arrêt, un worker rend son
  travail en cours à la file.
- La vidéo est servie par un lien signé (HMAC, valable une heure, clé dérivée de `APP_ENCRYPTION_KEY`), car une balise
  `<video>` ne peut pas envoyer d'en-tête d'authentification. Les requêtes partielles (`Range`) sont gérées pour la lecture.

## Ajouter…

- **un style** : un objet `StylePack` (`packages/styles/src/types.ts`) qui sait dessiner les quatre primitives, puis l'ajouter à `stylePacks`.
- **un personnage, un accessoire, un décor** : une fonction dans `packages/library`, déclarée dans `registry` et décrite dans `catalog`
  (le catalogue sert à l'éditeur, à la validation et aux consignes données aux modèles).
- **un fournisseur de modèles** : une entrée dans `PROVIDERS` (`packages/providers`) et, si son API diffère, sa façon de lister les modèles.

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
- **Serveur** (`LiveHub`, une salle par projet ouvert) : la salle tient le projet de référence, numérote chaque
  modification acceptée, la valide (schéma complet), l'envoie aux autres et accuse réception à l'auteur (`ack`) ou
  la refuse (`nack` + raison). Enregistrement 2 s après la dernière modification (10 s au plus), et quand le dernier
  participant part ; les enregistrements d'une séance mettent à jour la même version tant qu'elle reste la dernière,
  du même auteur et récente, jamais une version que la salle n'a pas écrite (création, enregistrement par l'API).
  Un `PUT` par l'API enregistre d'abord la salle, puis la remet à zéro pour tous (`reset`).
- **Client** (`LiveDoc`, partagé par l'éditeur et les tests) : il applique tout de suite ce que l'utilisateur tape,
  le garde « en attente » jusqu'à l'accusé, et rejoue les modifications en attente par-dessus celles des autres :
  tout le monde converge vers l'ordre du serveur (vérifié sur des entrelacements aléatoires). Après une
  reconnexion, ce qui n'avait pas été accusé est rejoué sur le projet actuel.
- **Sécurité** : `GET /api/projects/:id/live?ws=<espace>` passe par le même contrôle (session, espace, rôle
  lecteur au moins) ; l'origine de la page doit être le serveur lui-même ; un lecteur reçoit mais ne peut rien
  envoyer ; messages de 4 Mo au plus. Quand le rôle d'un membre change ou qu'il quitte l'espace, ses connexions
  se ferment (code 4001) et l'éditeur se reconnecte avec ses nouveaux droits ; un projet supprimé ferme la salle.
- **Limite** : les salles vivent dans le processus de l'API. Avec plusieurs instances de l'API, il faut router un
  même projet vers la même instance (affinité), ou relier les salles (PostgreSQL `LISTEN/NOTIFY`). Les workers de
  rendu ne sont pas concernés.

## API (`apps/api`)

| route | rôle |
|---|---|
| `GET /api/health` | état (sans compte) |
| `GET /api/auth/me`, `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `PATCH /api/auth/me` | compte : état, inscription, connexion, déconnexion, nom et mot de passe |
| `GET /api/invitations/:token`, `POST /api/invitations/:token/accept` | invitation : ce qu'elle donne ; l'accepter une fois connecté |
| `GET /api/workspaces`, `POST /api/workspaces` | mes espaces ; en créer un |
| `GET/PATCH/DELETE /api/workspace` | l'espace courant : membres et invitations, renommer, supprimer (propriétaire, nom à retaper) |
| `POST /api/workspace/invitations`, `DELETE /api/workspace/invitations/:id` | créer un lien d'invitation (affiché une fois), le révoquer |
| `PATCH/DELETE /api/workspace/members/:userId` | changer un rôle, transmettre la propriété ; retirer un membre, partir |
| `GET /api/library`, `GET /api/schema` | bibliothèque, styles, modèles de projet ; schéma JSON du format |
| `GET/POST /api/projects`, `GET/PUT/DELETE /api/projects/:id` | projets ; `PUT` exige `baseVersion` (sinon 409 avec la version actuelle) et valide (422 avec les erreurs) |
| `GET /api/projects/:id/versions`, `GET /api/projects/:id/subtitles.srt` | historique ; sous-titres |
| `GET /api/projects/:id/live?ws=` (WebSocket) | édition en temps réel : reçoit `hello`, `ops`, `ack`/`nack`, `presence`, `saved`, `reset` ; envoie `ops`, `presence`, `save` |
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
