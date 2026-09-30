import { signedIn } from './auth';
import { expect, test } from './fixtures';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exampleCharacter, exampleDecor, exampleProp } from '../../../packages/ai/src/examples';

// A local stand-in for a text model speaking the OpenAI chat API. It answers each stage the way a model would:
// a storyboard, a drawing of each thing it needs (then a look at the image of it), each scene built from its
// storyboard entry with those drawings, then an edit of a scene.
const storyboard = {
  title: 'Le jumeau des champs', language: 'fr', style: 'flat', palette: ['#E07A5F', '#3D405B', '#81B29A', '#F2CC8F'],
  cast: [{ id: 'awa', name: 'Awa', description: 'Une agricultrice, casquette bleue.' }, { id: 'jumo', name: 'Jumo', description: 'Un petit drone jaune.' }],
  props: [{ id: 'sensor', name: 'Capteur', description: 'Un piquet vert qui clignote.' }],
  decors: [{ id: 'field', name: 'Le champ', description: "Un champ à l'aube." }, { id: 'night', name: 'La nuit', description: 'Le champ sous les étoiles.' }],
  sounds: [{ id: 'beep', name: 'Bip', description: 'le double bip joyeux de Jumo' }],
  scenes: [
    { id: 's1', title: 'Le matin', duration: 8, decor: 'field', props: ['sensor'], music: 'matin calme, flûte', narration: [{ id: 'l1', text: 'Awa observe ses champs.' }, { id: 'l2', speaker: 'jumo', text: 'Bip bip !' }], shots: ['Awa arrive', 'Jumo descend'] },
    { id: 's2', title: 'La nuit', duration: 6, decor: 'night', music: 'nuit, clochettes', narration: [{ id: 'l1', text: 'La nuit, Jumo veille.' }], shots: ['Jumo flotte'] },
  ],
};
const text = (c: unknown) => (typeof c === 'string' ? c : (c as { type: string; text?: string }[]).find((x) => x.type === 'text')?.text ?? '');
let server: Server, base = '';
const asked: string[] = [];
test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      if (req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
      const body = JSON.parse(raw), system: string = body.messages[0].content, lastMsg = body.messages.at(-1), last = text(lastMsg.content);
      let out: unknown;
      const drawn = /Draw the \w+ "[^"]*" \(id "([^"]+)"\)/.exec(last)?.[1];
      if (system.includes('STORYBOARD')) { asked.push('storyboard'); out = storyboard; }
      else if (system.startsWith('You draw')) { asked.push(`draw ${drawn}`); out = system.includes('A CHARACTER.') ? exampleCharacter : system.includes('A PROP') ? exampleProp : exampleDecor; }
      else if (system.startsWith('You review')) { const seen = Array.isArray(lastMsg.content) && lastMsg.content.some((x: { type: string }) => x.type === 'image_url'); asked.push(`look ${drawn}${seen ? '' : ' (no image)'}`); out = { ok: true }; }
      else if (system.startsWith('You prepare')) { out = { new: [] }; }
      else if (system.startsWith('You compose')) { asked.push('compose'); out = { pieces: { aube: { name: 'Aube', bpm: 80, key: 'D', chords: ['I', 'vi', 'IV', 'V'], parts: [{ instrument: 'pad', play: 'chords' }, { instrument: 'flute', play: 'melody', notes: ['1 - 3 - 5 - - - . . . . . . . .'] }] } }, music: { s1: 'aube', s2: 'aube' } }; }
      else if (system.startsWith('You design')) { asked.push('design sounds'); out = { beep: { layers: [{ wave: 'square', freq: [900], duration: 0.08, decay: 0.04 }, { wave: 'square', freq: [1300], start: 0.12, duration: 0.08, decay: 0.04 }] } }; }
      else if (last.includes('Change it as follows')) { asked.push('edit'); const scene = JSON.parse(last.slice(last.indexOf('{'), last.indexOf('\n\nChange it'))); out = { ...scene, music: { mood: 'epic', gain: 0 } }; }
      else {
        const entry = JSON.parse(last.slice(last.indexOf('{', last.indexOf('storyboard entry'))));
        asked.push(`scene ${entry.id}`);
        out = { id: entry.id, title: entry.title, duration: entry.duration, decor: { kind: entry.decor }, narration: entry.narration, sfx: [{ t: 1, kind: 'beep' }],
          elements: [{ id: 'awa', type: 'character', ref: 'awa', layer: 5, keys: [{ t: 0, x: 300, y: 900, pose: 'walk' }, { t: { line: 'l1', edge: 'end' }, x: 800, pose: 'wave', expression: 'happy' }] }] };
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }], usage: { prompt_tokens: 1200, completion_tokens: 300 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
test.afterAll(() => { server.close(); });

test('text → storyboard (reviewed and edited) → scenes → project, then an AI edit of a scene', async ({ page }) => {
  await signedIn(page);
  const cred = await (await page.request.post('/api/credentials', { data: { provider: 'openai', label: 'modèle local', apiKey: 'sk-local-llm-000000', baseUrl: base } })).json();
  for (const [task, model] of [['storyboard', 'gpt-story'], ['scenes', 'gpt-scenes']]) expect((await page.request.put(`/api/assignments/${task}`, { data: { credentialId: cred.id, model } })).ok()).toBe(true);

  await page.goto('/');
  const ai = page.getByRole('region', { name: "créer avec l'IA" });
  await ai.getByLabel('texte source').fill("Awa est agricultrice. Elle rêve d'un jumeau numérique de son territoire, et Jumo, son drone, l'aide la nuit.");
  // the style is chosen by seeing it: a card per style, the example film drawn in each
  await ai.getByRole('button', { name: /style du film/ }).click();
  const styles = page.getByRole('dialog', { name: 'Style du film' });
  await expect(styles.getByRole('radio')).toHaveCount(6);
  await styles.getByRole('radio', { name: 'style Vectoriel plat' }).click();
  await styles.getByRole('button', { name: 'Choisir Vectoriel plat' }).click();
  await expect(ai.getByRole('button', { name: 'style du film : Vectoriel plat' })).toBeVisible();
  // the options are the tracks of a timeline: the length on a ruler (its playhead follows), the rest as clips
  await ai.getByRole('button', { name: 'Plus d’options' }).click();
  await ai.getByRole('radiogroup', { name: 'durée' }).getByRole('radio', { name: '1 min' }).click();
  await expect(ai.getByRole('radio', { name: '1 min' })).toHaveAttribute('aria-checked', 'true');
  await ai.getByRole('radiogroup', { name: 'Ton' }).getByRole('radio', { name: 'Poétique' }).click();
  const sent = page.waitForRequest((r) => r.url().endsWith('/api/generations') && r.method() === 'POST');
  await ai.getByRole('button', { name: 'Générer' }).click();
  expect((await sent).postDataJSON()).toMatchObject({ style: 'flat', targetSeconds: 60, instructions: 'Ton : poétique.' });
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('gen-status')).toContainText('Relisez', { timeout: 20_000 });
  await expect(page.getByTestId('gen-status')).toContainText('OpenAI · gpt-story');
  await expect(page.getByTestId('story-scene')).toHaveCount(2);

  // correct a line of the script before the scenes are written
  await page.getByLabel('réplique s2/l1').fill('La nuit tombe, et Jumo veille sur les capteurs.');
  // and what one of the characters looks like, before it is drawn
  await expect(page.getByTestId('thing')).toHaveCount(6); // 2 characters, 1 prop, 1 sound, 2 decors
  await page.getByLabel('description de Awa').fill('Une agricultrice sénégalaise, casquette bleue, tablette à la main.');
  await page.getByLabel('musique de s2').fill('nuit paisible, clochettes');
  await page.getByRole('button', { name: 'Dessiner, composer et écrire les scènes' }).click();
  await expect(page.getByTestId('gen-status')).toContainText('Terminé', { timeout: 30_000 });
  // everything was drawn for this film, each drawing looked at as an image, then the scenes written with them
  expect(asked.filter((a) => a.startsWith('draw')).sort()).toEqual(['draw awa', 'draw field', 'draw jumo', 'draw night', 'draw sensor']);
  expect(asked.filter((a) => a.startsWith('look')).sort()).toEqual(['look awa', 'look field', 'look jumo', 'look night', 'look sensor']);
  expect(asked.filter((a) => a.startsWith('scene')).sort()).toEqual(['scene s1', 'scene s2']);
  expect(asked.filter((a) => a === 'compose' || a === 'design sounds').sort()).toEqual(['compose', 'design sounds']);
  await expect(page.getByRole('list', { name: 'étapes' })).toContainText('Dessins 5/5');
  await page.getByRole('button', { name: 'Ouvrir le projet' }).click();

  await expect(page).toHaveURL(/\/p\//);
  await expect(page.locator('.editor-bar h1')).toHaveText('Le jumeau des champs');
  // the film's own music and sound, played in the preview
  const saved = await (await page.request.get(`/api/projects/${new URL(page.url()).pathname.split('/').pop()}`)).json();
  expect(saved.project.scenes.map((x: { music: { mood: string } }) => x.music.mood)).toEqual(['aube', 'aube']);
  expect(Object.keys(saved.project.sounds)).toEqual(['beep']);
  await expect(page.getByTestId('sound-info')).toContainText(/son prêt|réplique/, { timeout: 20_000 });
  await page.getByRole('tab', { name: 'Voix' }).click();
  await expect(page.getByTestId('voice-line').filter({ hasText: 'capteurs' })).toHaveCount(1);

  // ask the model for a change, then take it back
  await page.getByRole('tab', { name: /Scène/ }).click();
  await page.getByLabel("modification demandée à l'IA").fill('rends cette scène plus épique');
  await page.getByRole('button', { name: 'Modifier' }).click();
  await expect(page.getByTestId('ai-note')).toContainText('OpenAI · gpt-scenes', { timeout: 20_000 });
  await page.getByText('Code de la scène (JSON)').click();
  await expect(page.getByLabel('scène (JSON)')).toHaveValue(/"mood": "epic"/);
  await expect(page.getByTestId('save-state')).toHaveText('modifié');
  await page.getByRole('button', { name: 'Annuler la modification' }).click();
  await expect(page.getByLabel("scène (JSON)")).toHaveValue(/"mood": "aube"/); // back to the composed piece

  // the film's drawings: looked at, drawn again with a change
  await page.getByRole('tab', { name: 'Dessins' }).click();
  await expect(page.getByRole('list', { name: 'dessins du film' }).getByRole('button')).toHaveCount(5);
  await page.getByTestId('drawing-sensor').click();
  await expect(page.getByTestId('asset-view-sensor')).toBeVisible();
  await page.getByLabel('changement du dessin').fill('plus grand, avec une antenne');
  await page.getByRole('button', { name: "Redessiner avec l'IA" }).click();
  await expect(page.getByTestId('drawing-note')).toContainText('OpenAI · gpt-scenes', { timeout: 20_000 });
  expect(asked.filter((a) => a === 'draw sensor')).toHaveLength(2);
  // its music and sounds: composed again with a direction
  await page.getByRole('tab', { name: 'Musique' }).click();
  await expect(page.locator('.piece-list')).toContainText('Aube');
  await expect(page.locator('.sound-list')).toContainText('Bip');
  await page.getByLabel('direction musicale').fill('plus joyeux');
  await page.getByRole('button', { name: 'Recomposer la musique' }).click();
  await expect(page.getByTestId('music-note')).toContainText('1 morceau', { timeout: 20_000 });
});
