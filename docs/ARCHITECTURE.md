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
    "narration": [{ "id": "l1", "text": "Voici Awa.", "holdAfter": 0.6 }],
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

## Décors et plates

Un décor produit une partie **fixe** (peinte une seule fois par scène, gardée en mémoire comme une « plate » à la
résolution du plus fort zoom de la scène) et une partie **vivante** (nuages, étoiles qui scintillent) redessinée à chaque image.
La caméra ne fait que déplacer la plate. C'est ce qui rend l'aquarelle rapide : environ 10 ms par image en 960 px, dans Node.

## Ajouter…

- **un style** : un objet `StylePack` (`packages/styles/src/types.ts`) qui sait dessiner les quatre primitives, puis l'ajouter à `stylePacks`.
- **un personnage, un accessoire, un décor** : une fonction dans `packages/library`, déclarée dans `registry` et décrite dans `catalog`
  (le catalogue sert à l'éditeur, à la validation et aux consignes données aux modèles).
- **un fournisseur de modèles** : une entrée dans `PROVIDERS` (`packages/providers`) et, si son API diffère, sa façon de lister les modèles.

## API (`apps/api`)

| route | rôle |
|---|---|
| `GET /api/health` | état (sans jeton) |
| `GET /api/library`, `GET /api/schema` | bibliothèque, styles, modèles de projet ; schéma JSON du format |
| `GET/POST /api/projects`, `GET/PUT/DELETE /api/projects/:id` | projets ; `PUT` exige `baseVersion` (sinon 409 avec la version actuelle) et valide (422 avec les erreurs) |
| `GET /api/projects/:id/versions`, `GET /api/projects/:id/subtitles.srt` | historique ; sous-titres |
| `GET /api/providers` | fournisseurs et tâches |
| `GET/POST /api/credentials`, `PATCH/DELETE /api/credentials/:id` | clés (jamais renvoyées) |
| `POST /api/credentials/:id/test` | teste la clé et liste les modèles |
| `GET /api/assignments`, `PUT /api/assignments/:task` | un modèle par tâche |

Base de données : PostgreSQL (`pg`) ou PGlite embarqué, même SQL, migrations numérotées appliquées au démarrage.
