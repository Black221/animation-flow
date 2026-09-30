# 0001 · Sorties réseau vers des adresses données par les utilisateurs (SSRF)

Statut : accepté (cadrage du lot A2, tâche [FR 2.1]).

## Contexte

Un administrateur d'espace peut enregistrer une clé de fournisseur avec une adresse (`baseUrl`) : pour le fournisseur
« compatible OpenAI », mais aussi pour tous les autres (`Input.baseUrl` de `apps/api/src/routes/providers.ts`). Le
serveur appelle ensuite cette adresse, avec la clé dans un en-tête, depuis quatre fonctions de `packages/providers` :
`testCredential` (test d'une clé), `complete` (modèles de texte), `synthesize` (voix), `generateImage` (décors peints).
Elles reçoivent déjà leur `fetch` en paramètre (types `FetchLike`, `PostFetch`, `JsonPost`), mais l'API ne leur en
passe aucun en production : c'est le `fetch` global de Node qui part, vers n'importe quelle adresse, y compris
`127.0.0.1`, le réseau interne ou `169.254.169.254` (métadonnées du nuage).

Les autres sorties ne prennent pas d'adresse d'un utilisateur : Stripe (`https://api.stripe.com`, fixe), SMTP
(`SMTP_URL`, choisi par l'exploitant). `packages/ai` ne fait aucun appel réseau. `apps/web` n'importe de
`@af/providers` que des types, et ses `fetch` restent dans la même origine.

Node 22 embarque undici pour `fetch`, mais n'en exporte pas `Agent` : épingler l'adresse d'un `fetch` natif
demanderait d'ajouter la dépendance `undici`. `node:http`, `node:https`, `node:dns` et `net.BlockList` suffisent.

## Décision

1. **Un seul point de sortie** : `apps/api/src/net/safe-fetch.ts` fabrique une fonction compatible avec les trois types
   de `packages/providers` (elle rend un vrai `Response` de Node 22, construit sur le corps lu). `buildServer` l'utilise
   par défaut pour `fetchImpl`, `postFetch` et `llmFetch` ; les routes et `ai/models.ts` rendent ce paramètre
   obligatoire, et `packages/providers` perd son `fetch` global par défaut : aucun appel ne peut plus retomber sur le
   `fetch` global par oubli. `packages/providers` reste sans dépendance à Node pour le réseau (il reçoit la fonction) ;
   il reconnaît seulement les erreurs de `safe-fetch` à leur `name` pour donner un message clair.
2. **Vérifier, puis se connecter à l'adresse vérifiée** : pour chaque saut, le nom est résolu une fois
   (`dns.promises.lookup`, `all: true`) ; si **une** des adresses est interdite, la requête est refusée ; sinon la
   connexion passe par `http(s).request` avec une option `lookup` qui rend l'adresse déjà vérifiée (forme simple et
   forme `all`). Le nom reste celui de l'URL : SNI, vérification du certificat et en-tête `Host` sont ceux de Node, sans
   seconde résolution possible (DNS rebinding). Écarté : ajouter `undici` pour un `Agent` avec `connect.lookup`
   (une dépendance de plus pour le même résultat) ; se connecter à l'IP avec `servername` et `Host` recopiés à la main
   (SNI, crochets IPv6 et certificat à refaire soi-même).
3. **Politique d'adresses** (`net.BlockList`, adresses IPv4 dans IPv6 ramenées à IPv4) : 0/8, 10/8, 100.64/10, 127/8,
   169.254/16, 172.16/12, 192.0.0/24, 192.168/16, 198.18/15, 224/4, 240/4 ; `::`, `::1`, `fc00::/7`, `fe80::/10`,
   `fec0::/10`, `ff00::/8`, `64:ff9b:1::/48`, `2001::/32` (NAT64 local et Teredo : une IPv4 cachée) ; `64:ff9b::/96`
   et `2002::/16` sont jugés d'après l'IPv4 qu'ils portent ; et les
   noms `localhost`, `*.localhost`, `metadata.google.internal`, `metadata.goog`, `metadata`. Seuls `http:` et `https:`.
   `ALLOW_PRIVATE_PROVIDERS=true` (lu dans `apps/api/src/config.ts`, désactivé par défaut) laisse passer les adresses
   privées et locales, jamais le lien local (169.254/16, fe80::/10, `fd00:ec2::254`) ni les noms de métadonnées, ni les
   autres limites. Complément de la relecture : NAT64 (`64:ff9b::/96`) et 6to4 (`2002::/16`) sont jugés d'après
   l'IPv4 qu'ils portent (un hôte IPv6 derrière un DNS64 atteint ainsi les fournisseurs publics) ; les plages de
   documentation, 192.88.99/24 et l'IPv4 traduite (`::ffff:0:0:0/96`) sont refusées ; la résolution DNS est bornée par
   le délai de l'appel.
4. **Redirections suivies à la main** (5 au plus), chaque saut revérifié ; `https` → `http` refusé ; en changeant
   d'origine, les en-têtes de clés (`authorization`, `x-api-key`, `x-goog-api-key`, `xi-api-key`, `cookie`) sont
   retirés ; 301, 302, 303 après un POST repartent en GET sans corps, 307 et 308 renvoient le corps.
5. **Limites** : délai total (le signal de l'appelant, combiné à un plafond de `safe-fetch`) et taille maximale du corps
   (32 Mio par défaut : une image en base64 ou une minute de WAV y tiennent), vérifiée sur `Content-Length` puis compte
   des octets reçus, après décompression si le serveur compresse malgré `accept-encoding: identity`.
6. **La vérification a lieu à l'appel, pas à l'enregistrement** : une clé qui vise une adresse privée s'enregistre
   (un serveur local reste possible avec `ALLOW_PRIVATE_PROVIDERS`), son test et ses appels répondent « adresse
   refusée ». Vérifier aussi à l'enregistrement ne protégerait pas du rebinding et changerait le résultat d'un test
   existant (`apps/api/test/api.test.ts`, clé Ollama sur `localhost`).

## Conséquences

- Les clés déjà enregistrées qui visent un serveur local (Ollama) cessent de fonctionner tant que l'exploitant n'a pas
  mis `ALLOW_PRIVATE_PROVIDERS=true` : à dire dans le `CHANGELOG.md`, le `README.md` et le message d'erreur.
- Les tests de bout en bout qui simulent un fournisseur sur `127.0.0.1` (`generate.spec.ts`, `voices.spec.ts`)
  démarrent l'API avec `ALLOW_PRIVATE_PROVIDERS=true` ; le refus est prouvé par les tests de l'API.
- Pas de réponse en flux : aucun appelant n'en lit aujourd'hui (tous font `json()` ou `arrayBuffer()`). Un futur appel
  en flux (réponses de modèles au fil de l'eau) devra garder le même compteur d'octets et le même signal.
- Pas de connexions réutilisées d'une adresse non vérifiée : l'agent dédié ne réutilise que des sockets ouverts vers
  une adresse vérifiée. Un proxy de sortie (`HTTPS_PROXY`) n'est pas pris en charge : il faudrait revoir l'épinglage.
- Toute nouvelle sortie vers une adresse donnée par un utilisateur (webhooks sortants, import par URL) passe par
  `safe-fetch.ts` ; la relecture `securite` le vérifie.
