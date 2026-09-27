import type { ChatMessage } from '@af/providers';
import { exampleProject, parseProject } from '@af/schema';
import { describe, expect, it } from 'vitest';
import { editScene, extractJson, fallbackScene, generateScenes, generateStoryboard, InvalidAnswer, ModelError, Storyboard, type Model, type Step } from '../src';

/** a model that answers from a script, and remembers what it was asked */
function scripted(answers: (string | ((messages: ChatMessage[], system: string) => string))[]): Model & { calls: { system: string; messages: ChatMessage[] }[] } {
  const calls: { system: string; messages: ChatMessage[] }[] = [];
  let i = 0;
  return {
    label: 'fake', calls,
    async call({ system, messages }) {
      calls.push({ system, messages: [...messages] });
      const a = answers[Math.min(i++, answers.length - 1)]!;
      return { ok: true, text: typeof a === 'function' ? a(messages, system) : a, usage: { inputTokens: 100, outputTokens: 50 } };
    },
  };
}

const storyboard = {
  title: 'Le jumeau numérique', language: 'fr', style: 'flat',
  cast: [{ id: 'awa', kind: 'person', name: 'Awa', params: { skin: '#8A5A3C', cap: '#1F3A5F' } }, { id: 'jumo', kind: 'drone', name: 'Jumo' }],
  scenes: [
    { id: 's1', title: 'Le champ', duration: 10, decor: { kind: 'dawn-field' }, music: { mood: 'calm' }, narration: [{ id: 'l1', text: 'Voici Awa.' }, { id: 'l2', speaker: 'jumo', text: 'Bip !' }], shots: ['Awa arrive à pied', 'Jumo descend du ciel sur l2'] },
    { id: 's2', title: 'La nuit', duration: 8, decor: { kind: 'night-sky' }, narration: [{ id: 'l1', text: 'La nuit tombe.' }], shots: ['Jumo scintille'] },
  ],
};
const goodScene = (id: string, lines: string[]) => JSON.stringify({
  id, title: 'x', duration: 8, decor: { kind: 'plain' },
  narration: [{ id: 'zz', text: 'the model rewrote this' }], // must be replaced by the storyboard's lines
  elements: [{ id: 'awa', type: 'character', ref: 'awa', keys: [{ t: 0, x: 400, y: 900, pose: 'walk' }, { t: { line: lines[0] }, x: 800, pose: 'wave', expression: 'happy' }] }],
});

describe('extractJson', () => {
  it('finds JSON in fences or prose', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Voici : {"b": {"c": 2}} merci')).toEqual({ b: { c: 2 } });
    expect(() => extractJson('rien')).toThrow();
  });
});

describe('storyboard', () => {
  it('asks with the library and the language, and returns a valid storyboard', async () => {
    const m = scripted([JSON.stringify(storyboard)]), steps: Step[] = [];
    const sb = await generateStoryboard(m, 'Awa rêve d\'un jumeau numérique.', { language: 'fr', style: 'flat', targetSeconds: 20 }, (s) => steps.push(s));
    expect(sb.scenes.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(m.calls[0]!.system).toContain('French');
    expect(m.calls[0]!.system).toContain('dawn-field');
    expect(m.calls[0]!.system).toContain('about 20 seconds');
    expect(m.calls[0]!.messages[0]!.content).toContain('jumeau numérique');
    expect(steps).toMatchObject([{ stage: 'storyboard', attempt: 0, ok: true }]);
  });

  it('sends the problems back and accepts the repaired answer', async () => {
    const bad = { ...storyboard, scenes: [{ ...storyboard.scenes[0], decor: { kind: 'volcano' } }] };
    const m = scripted([JSON.stringify(bad), 'not json at all', JSON.stringify(storyboard)]);
    const sb = await generateStoryboard(m, 'x', { language: 'fr', style: 'flat' });
    expect(sb.title).toBe('Le jumeau numérique');
    expect(m.calls).toHaveLength(3);
    expect(m.calls[1]!.messages.at(-1)!.content).toContain('scenes.0.decor.kind');
    expect(m.calls[2]!.messages.at(-1)!.content).toContain('JSON');
  });

  it('gives up after two repairs with the issues', async () => {
    const m = scripted(['{"title": ""}']);
    await expect(generateStoryboard(m, 'x', { language: 'fr', style: 'flat' })).rejects.toBeInstanceOf(InvalidAnswer);
    expect(m.calls).toHaveLength(3);
  });

  it('stops at once on a provider failure', async () => {
    const m: Model = { label: 'x', call: async () => ({ ok: false, status: 401, error: 'clé refusée par le fournisseur' }) };
    await expect(generateStoryboard(m, 'x', { language: 'fr', style: 'flat' })).rejects.toBeInstanceOf(ModelError);
  });
});

describe('scenes', () => {
  const sb = Storyboard.parse(storyboard);

  it('keeps the approved narration, validates each scene and assembles the project', async () => {
    const m = scripted([(msgs) => (msgs[0]!.content.includes('Write scene s1') ? goodScene('s1', ['l1']) : goodScene('s2', ['l1']))]);
    const { project, results } = await generateScenes(m, sb, { concurrency: 2 });
    expect(results.map((r) => r.fallback)).toEqual([false, false]);
    expect(project.scenes[0]!.narration.map((l) => [l.id, l.speaker, l.text])).toEqual([['l1', 'narrator', 'Voici Awa.'], ['l2', 'jumo', 'Bip !']]);
    expect(project.cast.jumo!.kind).toBe('drone');
    expect(parseProject(project).ok).toBe(true);
    expect(m.calls[0]!.system).toContain('THE ANIMATION FORMAT');
  });

  it('repairs a scene that uses a pose the library does not have', async () => {
    const withBadPose = goodScene('s1', ['l1']).replace('"wave"', '"moonwalk"');
    const m = scripted([withBadPose, (msgs) => goodScene(msgs[0]!.content.includes('Write scene s1') ? 's1' : 's2', ['l1'])]);
    const { results } = await generateScenes(m, Storyboard.parse({ ...storyboard, scenes: [storyboard.scenes[0]] }), { concurrency: 1 });
    expect(results[0]!.fallback).toBe(false);
    expect(m.calls[1]!.messages.at(-1)!.content).toContain('moonwalk');
  });

  it('falls back to a plain scene when the model cannot get it right', async () => {
    const m = scripted(['{"elements": [{"id": "x", "type": "prop", "ref": "unicorn", "keys": [{"t": 0}]}]}']);
    const { project, results } = await generateScenes(m, sb, { concurrency: 1 });
    expect(results.every((r) => r.fallback)).toBe(true);
    expect(results[0]!.issues.some((i) => i.message.includes('unicorn'))).toBe(true);
    expect(project.scenes[0]!.elements.map((e) => e.id)).toEqual(['awa', 'jumo', 'title']);
    expect(parseProject(project).ok).toBe(true);
  });

  it('builds a valid fallback for every storyboard scene', () => {
    for (const s of sb.scenes) expect(parseProject({ schemaVersion: 1, title: 't', cast: { awa: { kind: 'person', name: 'Awa' }, jumo: { kind: 'drone', name: 'Jumo' } }, scenes: [fallbackScene(sb, s)] }).ok).toBe(true);
  });
});

describe('edit a scene', () => {
  const project = (() => { const r = parseProject(exampleProject); if (!r.ok) throw new Error(); return r.project; })();
  it('applies a valid change and keeps the scene id', async () => {
    const changed = { ...project.scenes[1]!, id: 'renamed', music: { mood: 'epic', gain: 0 } };
    const m = scripted([JSON.stringify(changed)]);
    const s = await editScene(m, project, 1, 'plus épique');
    expect(s.id).toBe('s2');
    expect(s.music.mood).toBe('epic');
    expect(m.calls[0]!.messages[0]!.content).toContain('plus épique');
  });
  it('keeps what the model left out, and the recordings of unchanged lines', async () => {
    const p = structuredClone(project);
    p.scenes[0]!.narration[0]!.audio = { asset: 'a'.repeat(32), textHash: 'x' }; p.scenes[0]!.narration[0]!.duration = 1.23;
    const { narration: _n, ...withoutNarration } = p.scenes[0]!;
    const s = await editScene(scripted([JSON.stringify({ ...withoutNarration, music: { mood: 'calm' } })]), p, 0, 'plus calme');
    expect(s.narration[0]).toMatchObject({ id: 'l1', duration: 1.23, audio: { asset: 'a'.repeat(32) } });
    const reworded = p.scenes[0]!.narration.map((l, i) => (i === 0 ? { id: l.id, speaker: l.speaker, text: 'Voici notre Awa.' } : { id: l.id, speaker: l.speaker, text: l.text }));
    const s2 = await editScene(scripted([JSON.stringify({ ...withoutNarration, narration: reworded })]), p, 0, 'reformule');
    expect(s2.narration[0]!.audio).toBeUndefined();
    expect(s2.narration[0]!.text).toBe('Voici notre Awa.');
  });

  it('refuses an edit that stays invalid', async () => {
    const m = scripted(['{"id": "s2", "decor": {"kind": 3}}']);
    await expect(editScene(m, project, 1, 'x')).rejects.toBeInstanceOf(InvalidAnswer);
  });
});
