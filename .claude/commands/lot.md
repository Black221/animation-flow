---
description: Traiter un ou plusieurs lots de NEXT_PROMPTS.md avec cadrage, portes, relecture indépendante et PR. Exemple : /lot A1 A2
argument-hint: <ID> [<ID> ...]
---
Traite les lots suivants de `NEXT_PROMPTS.md`, dans cet ordre : $ARGUMENTS

Avant tout : vérifie que `NEXT_PROMPTS.md` existe et contient chacun de ces identifiants, sinon arrête-toi et dis ce
qui manque. Lance `pnpm install` si `node_modules` manque. Plus de 3 lots : dis-le et propose de scinder.

Pour chacun, applique exactement la méthode de `CLAUDE.md` (branche, cadrage par `architecte` si marqué C,
implémentation, portes, relecture par `relecteur` et, si marqué 🔒, par `securite`, avec seulement branche + base +
identifiant + « Fini quand », au plus deux tours de correction, clôture, commit et push, PR).

Consulte le tableau des sessions de `docs/ORCHESTRATION.md` pour savoir quels lots sont marqués C, 🔒 ou ⏸.
Si un prompt dit « À fournir » et que l'élément manque, ou si le lot est marqué ⏸ et que la décision de l'humain
n'est pas dans le dépôt, arrête-toi et liste ce qu'il te faut avant de continuer.
Termine par le rapport final de `CLAUDE.md` pour chaque lot, en un seul message.
