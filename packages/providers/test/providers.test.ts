import { describe, expect, it, vi } from 'vitest';
import { maskKey, PROVIDERS, testCredential, type FetchLike } from '../src';

const reply = (status: number, body: unknown = {}) => ({ ok: status < 400, status, json: async () => body });

describe('testCredential', () => {
  it('lists Anthropic models with the right headers', async () => {
    const f = vi.fn<FetchLike>(async () => reply(200, { data: [{ id: 'claude-b', display_name: 'B' }, { id: 'claude-a', display_name: 'A' }] }));
    const r = await testCredential('anthropic', { apiKey: 'sk-ant-secret-123456' }, f);
    expect(r).toEqual({ ok: true, models: [{ id: 'claude-a', label: 'A' }, { id: 'claude-b', label: 'B' }] });
    expect(f.mock.calls[0]![0]).toBe('https://api.anthropic.com/v1/models?limit=100');
    expect(f.mock.calls[0]![1]!.headers).toMatchObject({ 'x-api-key': 'sk-ant-secret-123456', 'anthropic-version': '2023-06-01' });
  });

  it('keeps only Gemini models that generate content, without the models/ prefix', async () => {
    const f = vi.fn<FetchLike>(async () => reply(200, { models: [{ name: 'models/gemini-x', displayName: 'X', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed', supportedGenerationMethods: ['embedContent'] }] }));
    const r = await testCredential('google', { apiKey: 'AIza-key-123456' }, f);
    expect(r).toEqual({ ok: true, models: [{ id: 'gemini-x', label: 'X' }] });
  });

  it('uses the given address for a compatible server and allows no key', async () => {
    const f = vi.fn<FetchLike>(async () => reply(200, { data: [{ id: 'llama3' }] }));
    const r = await testCredential('openai-compatible', { baseUrl: 'http://localhost:11434/v1/' }, f);
    expect(r.ok).toBe(true);
    expect(f.mock.calls[0]![0]).toBe('http://localhost:11434/v1/models');
    expect(f.mock.calls[0]![1]!.headers).toEqual({});
  });

  it('checks the OpenRouter key before listing', async () => {
    const f = vi.fn<FetchLike>(async (url) => (url.endsWith('/key') ? reply(401) : reply(200, { data: [] })));
    expect(await testCredential('openrouter', { apiKey: 'sk-or-xxxxxxxxxxxx' }, f)).toEqual({ ok: false, status: 401, error: 'clé refusée par le fournisseur' });
  });

  it('explains refusals and never echoes the key', async () => {
    const f = vi.fn<FetchLike>(async () => reply(402));
    const r = await testCredential('openai', { apiKey: 'sk-very-secret-key-9999' }, f);
    expect(r).toEqual({ ok: false, status: 402, error: 'crédit insuffisant sur ce compte' });
    expect(JSON.stringify(r)).not.toContain('secret');
  });

  it('reports network failures and missing inputs', async () => {
    const f = vi.fn<FetchLike>(async () => { throw new TypeError('fetch failed sk-leak'); });
    const r = await testCredential('mistral', { apiKey: 'k-123456789012' }, f);
    expect(r).toEqual({ ok: false, error: 'fournisseur injoignable' });
    expect(await testCredential('openai', {}, f)).toEqual({ ok: false, error: 'clé manquante' });
    expect(await testCredential('nope', { apiKey: 'x' }, f)).toMatchObject({ ok: false });
  });
});

it('masks keys and has unique provider ids', () => {
  expect(maskKey('sk-abcdefghijklmnop')).toBe('…mnop');
  expect(maskKey('short')).toBe('…');
  expect(new Set(PROVIDERS.map((p) => p.id)).size).toBe(PROVIDERS.length);
});
