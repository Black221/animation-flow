// A small example project: the opening of « Awa et Jumo » (scene 1.1 of the original film, simplified) followed by a
// short night scene. It exercises every part of the format: cast, decor, narration, cue-locked keys, camera, text.
import type { ProjectInput } from './index';

const L = (line: string, edge: 'start' | 'end' = 'start', offset = 0) => ({ line, edge, offset });

export const exampleProject: ProjectInput = {
  schemaVersion: 1,
  title: 'Awa et Jumo : la carte avant le voyage',
  language: 'fr',
  fps: 24,
  width: 1920,
  height: 1080,
  style: 'watercolor',
  cast: {
    awa: {
      kind: 'person',
      name: 'Awa',
      params: { skin: '#8A5A3C', hair: '#2A1A12', hairStyle: 'braid', top: '#E0A33A', bottom: '#3E7C4A', cap: '#1F3A5F', height: 1 },
    },
    jumo: { kind: 'drone', name: 'Jumo', params: { body: '#3F7FC4', screen: '#1F3A5F', glow: '#3BC4D8' } },
  },
  scenes: [
    {
      id: 's1',
      title: 'La carte avant le voyage',
      duration: 30,
      decor: { kind: 'dawn-field', params: { sun: '#F2C14E', sky: ['#BFD9E6', '#F6D6B0'], field: '#7FAF6A' } },
      narration: [
        { id: 'l1', text: 'Voici Awa.', holdAfter: 0.6 },
        { id: 'l2', text: "Elle rêve d'un jumeau numérique capable de dire à son territoire quels futurs sont encore possibles." },
        { id: 'l3', text: 'Pas si vite.', holdAfter: 1 },
        { id: 'l4', text: "Mais avant de construire quoi que ce soit, il faut savoir ce que le monde sait déjà." },
        { id: 'l5', text: "Et pour ça, on ne fouille pas au hasard : on écrit d'abord les règles de la quête." },
        { id: 'l6', text: 'Quatre questions. Des critères clairs.' },
        { id: 'l7', text: 'Et un protocole… verrouillé.' },
        { id: 'l8', text: 'Toute modification ? Datée et justifiée.' },
      ],
      camera: [
        { t: 0, x: 960, y: 540, zoom: 1 },
        { t: L('l2'), x: 960, y: 540, zoom: 1 },
        { t: L('l2', 'end'), ease: 'inOut', x: 860, y: 600, zoom: 1.25 },
        { t: L('l4'), ease: 'inOut', x: 960, y: 540, zoom: 1 },
      ],
      elements: [
        {
          id: 'title', type: 'text', space: 'screen', layer: 20,
          params: { text: 'Awa et Jumo', size: 96, color: '#1F3A5F', font: 'display', subtitle: 'la carte avant le voyage' },
          exit: L('l2', 'start', 0.4),
          keys: [{ t: 0, x: 960, y: 200, opacity: 0, scale: 0.8 }, { t: 0.8, ease: 'backOut', opacity: 1, scale: 1 }, { t: L('l2'), opacity: 1 }, { t: L('l2', 'start', 0.4), opacity: 0 }],
        },
        { id: 'tree', type: 'prop', ref: 'tree', layer: 1, keys: [{ t: 0, x: 1560, y: 820, scale: 1.2 }] },
        { id: 'house', type: 'prop', ref: 'house', layer: 1, keys: [{ t: 0, x: 1250, y: 700, scale: 0.8 }] },
        { id: 'tractor', type: 'prop', ref: 'tractor', layer: 2, keys: [{ t: 0, x: 560, y: 860, scale: 1 }] },
        ...[180, 420, 1000, 1180, 1420, 1720].map((x, i) => ({
          id: `sensor${i + 1}`, type: 'prop' as const, ref: 'sensor', layer: 3, params: { phase: i * 0.7 },
          keys: [{ t: 0, x, y: 930 + (i % 2) * 40, scale: 1 }],
        })),
        {
          id: 'awa', type: 'character', ref: 'awa', layer: 5,
          keys: [
            { t: 0, x: -150, y: 900, pose: 'walk', expression: 'happy', facing: 1 },
            { t: L('l1', 'end', 0.4), ease: 'out', x: 820, pose: 'walk' },
            { t: L('l1', 'end', 0.5), pose: 'wave' },
            { t: L('l2', 'start', 0.3), pose: 'dream', expression: 'dreamy' },
            { t: L('l3'), pose: 'idle', expression: 'surprised' },
            { t: L('l4'), pose: 'think', expression: 'thinking' },
            { t: L('l5'), pose: 'point', expression: 'neutral' },
            { t: L('l6'), pose: 'hold', expression: 'happy' },
          ],
        },
        {
          id: 'jumo', type: 'character', ref: 'jumo', layer: 6,
          keys: [
            { t: 0, x: 2250, y: 420, expression: 'happy', facing: -1 },
            { t: L('l1', 'end'), ease: 'inOut', x: 1060, y: 560 },
            { t: L('l3'), ease: 'backOut', x: 1000, y: 610, expression: 'surprised' },
            { t: L('l4'), ease: 'inOut', x: 1080, y: 520, expression: 'thinking' },
            { t: L('l7'), expression: 'happy' },
          ],
        },
        {
          id: 'protocol', type: 'prop', ref: 'sign', layer: 8, enter: L('l5'),
          params: { text: 'Protocole de la quête\n4 questions · critères clairs', width: 520, height: 190, board: '#F6EBD6', ink: '#1F3A5F' },
          keys: [{ t: L('l5'), x: 1380, y: 420, scale: 0.2, opacity: 0 }, { t: L('l5', 'start', 0.6), ease: 'backOut', scale: 1, opacity: 1 }],
        },
        {
          id: 'lock', type: 'prop', ref: 'padlock', layer: 9, enter: L('l7'),
          keys: [{ t: L('l7'), x: 1600, y: 300, scale: 0.2, rotation: -0.4, opacity: 0 }, { t: L('l7', 'end'), ease: 'backOut', scale: 1, rotation: 0.1, opacity: 1 }],
        },
        {
          id: 'stamp', type: 'text', layer: 10, enter: L('l8', 'start', 0.6),
          params: { text: 'daté et justifié', size: 44, color: '#C8553D', font: 'marker', frame: true },
          keys: [{ t: L('l8', 'start', 0.6), x: 1380, y: 560, scale: 1.8, rotation: -0.12, opacity: 0 }, { t: L('l8', 'start', 0.9), ease: 'out', scale: 1, opacity: 1 }],
        },
      ],
    },
    {
      id: 's2',
      title: 'Jumo prend des antennes',
      duration: 8,
      transition: 'fade',
      decor: { kind: 'night-sky', params: { sky: ['#101E36', '#1F3A5F'], stars: 90 } },
      narration: [{ id: 'l1', text: 'La nuit, Jumo apprend à écouter le terrain.' }],
      camera: [{ t: 0, x: 960, y: 540, zoom: 1.1 }, { t: 8, ease: 'inOut', x: 960, y: 540, zoom: 1 }],
      elements: [
        {
          id: 'jumo', type: 'character', ref: 'jumo', layer: 2, params: { antennas: true },
          keys: [{ t: 0, x: 960, y: 620, expression: 'sleepy', scale: 1.4 }, { t: L('l1', 'end'), ease: 'inOut', y: 520, expression: 'happy' }],
        },
        {
          id: 'caption', type: 'text', space: 'screen', layer: 5,
          params: { text: 'modèle → ombre → jumeau', size: 48, color: '#BDF1F6', font: 'display' },
          keys: [{ t: L('l1', 'end'), x: 960, y: 190, opacity: 0 }, { t: L('l1', 'end', 0.6), opacity: 1 }],
        },
      ],
    },
  ],
};
