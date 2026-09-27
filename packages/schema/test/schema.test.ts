import { describe, expect, it } from 'vitest';
import { exampleProject, parseProject, projectJsonSchema, type ProjectInput } from '../src';

const clone = <T>(v: T): T => structuredClone(v);

describe('project schema', () => {
  it('accepts the example project and fills defaults', () => {
    const r = parseProject(exampleProject);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project.scenes[0]!.narration[0]!.speaker).toBe('narrator');
    expect(r.project.scenes[0]!.elements.find((e) => e.id === 'tree')!.space).toBe('world');
  });

  it('rejects duplicate ids', () => {
    const p = clone(exampleProject) as ProjectInput;
    p.scenes[0]!.elements!.push({ ...p.scenes[0]!.elements![0]! });
    const r = parseProject(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => /en double/.test(i.message))).toBe(true);
  });

  it('rejects a time that points at a missing line, with a readable path', () => {
    const p = clone(exampleProject) as ProjectInput;
    p.scenes[0]!.camera!.push({ t: { line: 'nope' }, zoom: 2 });
    const r = parseProject(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toContainEqual({ path: 'scenes.0.camera.4.t', message: expect.stringContaining('nope') });
  });

  it('rejects a character that is not in the cast', () => {
    const p = clone(exampleProject) as ProjectInput;
    p.scenes[1]!.elements![0]!.ref = 'ghost';
    const r = parseProject(p);
    expect(r.ok).toBe(false);
  });

  it('rejects bad colours and ids from the base schema', () => {
    const r = parseProject({ schemaVersion: 1, title: 'x', scenes: [{ id: 'bad id!', decor: { kind: 'plain' } }] });
    expect(r.ok).toBe(false);
  });

  it('exports a JSON Schema for models and tools', () => {
    const js = projectJsonSchema() as { type?: string; properties?: Record<string, unknown> };
    expect(js.type).toBe('object');
    expect(js.properties).toHaveProperty('scenes');
  });
});
