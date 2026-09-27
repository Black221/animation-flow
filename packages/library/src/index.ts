// The component library: what projects can put on screen, whatever the style.
import type { Catalog, Registry } from '@af/engine';
import { dawnField, nightSky, plain } from './decors';
import { drone, DRONE_EXPRESSIONS } from './drone';
import { person, PERSON_EXPRESSIONS, PERSON_POSES } from './person';
import { padlock, sensor, sign, sparkle, tablet, tractor, house, tree } from './props';
import { text } from './text';

export const registry: Registry = {
  characters: { person, drone },
  props: { tractor, sensor, sign, padlock, tree, house, tablet, sparkle },
  decors: { 'dawn-field': dawnField, 'night-sky': nightSky, plain },
  text,
};

const colour = 'couleur (#rrggbb)';
export const catalog: Catalog = {
  characters: [
    {
      kind: 'person', label: 'Personne', poses: [...PERSON_POSES], expressions: [...PERSON_EXPRESSIONS],
      params: { skin: colour, hair: colour, hairStyle: 'short | braid | bun | long | none', top: `haut, ${colour}`, bottom: `bas / salopette, ${colour}`, overalls: 'salopette (booléen)', cap: `casquette, ${colour} (absente si vide)`, capBand: colour, shoes: colour },
    },
    {
      kind: 'drone', label: 'Robot volant', poses: ['idle'], expressions: [...DRONE_EXPRESSIONS],
      params: { body: colour, screen: colour, glow: `visage de l'écran, ${colour}`, antennas: 'antennes (booléen)', badge: 'texte du badge' },
    },
  ],
  props: [
    { kind: 'tractor', label: 'Tracteur', params: { color: colour, wheel: colour } },
    { kind: 'sensor', label: 'Capteur connecté', params: { glow: colour, phase: 'décalage du clignotement (s)' } },
    { kind: 'sign', label: 'Panneau avec texte', params: { text: 'texte (\\n pour une nouvelle ligne)', width: 'px', height: 'px', size: 'taille max. du texte', board: colour, ink: colour, post: 'poteau (booléen)' } },
    { kind: 'padlock', label: 'Cadenas', params: { color: colour } },
    { kind: 'tree', label: 'Arbre', params: { leaves: colour } },
    { kind: 'house', label: 'Maison', params: { wall: colour, roof: colour } },
    { kind: 'tablet', label: 'Tablette', params: { glow: colour } },
    { kind: 'sparkle', label: 'Étincelle', params: { color: colour } },
  ],
  decors: [
    { kind: 'dawn-field', label: "Champs à l'aube", params: { sky: '[haut, bas] couleurs', sun: colour, field: colour } },
    { kind: 'night-sky', label: 'Ciel de nuit', params: { sky: '[haut, bas] couleurs', stars: "nombre d'étoiles" } },
    { kind: 'plain', label: 'Fond uni', params: { color: colour } },
  ],
};

export { person, drone, PERSON_POSES, PERSON_EXPRESSIONS, DRONE_EXPRESSIONS };
