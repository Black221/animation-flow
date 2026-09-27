import { describe, expect, it, vi } from 'vitest';
import { complete, maskKey, PROVIDERS, synthesize, testCredential, type FetchLike } from '../src';

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

describe('synthesize', () => {
  const audio = new Uint8Array(200).fill(7);
  const ok = () => vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => audio.buffer }));

  it('calls Fish Audio with the voice as reference_id and the model header', async () => {
    const f = ok();
    const r = await testSpeech('fish-audio', f, { text: ' Bonjour. ', voice: 'voice-123', model: 's1' });
    expect(r).toMatchObject({ ok: true, format: 'mp3' });
    const [url, init] = f.mock.calls[0]! as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('https://api.fish.audio/v1/tts');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer k-123456789012', model: 's1' });
    expect(JSON.parse(init.body)).toMatchObject({ text: 'Bonjour.', reference_id: 'voice-123', format: 'mp3' });
  });

  it('calls ElevenLabs with the voice in the path and the default model', async () => {
    const f = ok();
    await testSpeech('elevenlabs', f, { text: 'Salut', voice: 'abc DEF', language: 'fr' });
    const [url, init] = f.mock.calls[0]! as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/abc%20DEF?output_format=mp3_44100_128');
    expect(init.headers['xi-api-key']).toBe('k-123456789012');
    expect(JSON.parse(init.body)).toEqual({ text: 'Salut', model_id: 'eleven_multilingual_v2', language_code: 'fr' });
  });

  it('asks OpenAI for WAV, with a built-in voice by default', async () => {
    const f = ok();
    const r = await testSpeech('openai', f, { text: 'Hello', voice: '' });
    expect(r).toMatchObject({ ok: true, format: 'wav' });
    const [url, init] = f.mock.calls[0]! as unknown as [string, { body: string }];
    expect(url).toBe('https://api.openai.com/v1/audio/speech');
    expect(JSON.parse(init.body)).toEqual({ model: 'gpt-4o-mini-tts', voice: 'alloy', input: 'Hello', response_format: 'wav' });
  });

  it('explains failures without leaking the key', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 402, arrayBuffer: async () => new ArrayBuffer(0) }));
    const r = await testSpeech('fish-audio', f, { text: 'x', voice: 'v' });
    expect(r).toEqual({ ok: false, status: 402, error: 'crédit insuffisant sur ce compte' });
    expect(await synthesize('anthropic', { apiKey: 'k' }, { text: 'x', voice: 'v' }, f as never)).toMatchObject({ ok: false });
    expect(await synthesize('fish-audio', { apiKey: 'k' }, { text: 'x', voice: '' }, f as never)).toMatchObject({ ok: false, error: expect.stringContaining('voix') });
    expect(await synthesize('fish-audio', {}, { text: 'x', voice: 'v' }, f as never)).toEqual({ ok: false, error: 'clé manquante' });
  });
});

const testSpeech = (p: string, f: unknown, req: { text: string; voice: string; model?: string; language?: string }) =>
  synthesize(p, { apiKey: 'k-123456789012' }, req, f as never);

describe('complete', () => {
  const json = { name: 'scene', schema: { type: 'object' } };
  const call = (f: ReturnType<typeof vi.fn>) => { const [url, init] = f.mock.calls[0]! as unknown as [string, { headers: Record<string, string>; body: string }]; return { url, headers: init.headers, body: JSON.parse(init.body) }; };
  const reply = (b: unknown, status = 200) => vi.fn(async () => ({ ok: status < 400, status, json: async () => b }));

  it('forces a tool on Anthropic and returns its input as JSON', async () => {
    const f = reply({ content: [{ type: 'tool_use', name: 'scene', input: { a: 1 } }], usage: { input_tokens: 10, output_tokens: 5 } });
    const r = await complete('anthropic', { apiKey: 'k-1' }, { model: 'claude-x', system: 'S', messages: [{ role: 'user', content: 'U' }], json }, f as never);
    expect(r).toEqual({ ok: true, text: '{"a":1}', usage: { inputTokens: 10, outputTokens: 5 } });
    const c = call(f);
    expect(c.url).toBe('https://api.anthropic.com/v1/messages');
    expect(c.body).toMatchObject({ model: 'claude-x', system: 'S', tool_choice: { type: 'tool', name: 'scene' }, tools: [{ input_schema: { type: 'object' } }] });
  });

  it('uses json_schema with OpenAI and JSON mode with Mistral and OpenRouter', async () => {
    const answer = { choices: [{ message: { content: '{"b":2}' } }], usage: { prompt_tokens: 3, completion_tokens: 4 } };
    const f = reply(answer);
    expect(await complete('openai', { apiKey: 'k' }, { model: 'gpt-x', system: 'S', messages: [{ role: 'user', content: 'U' }], json }, f as never)).toMatchObject({ ok: true, text: '{"b":2}' });
    expect(call(f).body).toMatchObject({ messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }], response_format: { type: 'json_schema' }, max_completion_tokens: 8000 });
    for (const id of ['mistral', 'openrouter']) {
      const g = reply(answer);
      await complete(id, { apiKey: 'k' }, { model: 'm', system: 'S', messages: [], json }, g as never);
      expect(call(g).body.response_format).toEqual({ type: 'json_object' });
      expect(call(g).body.max_tokens).toBe(8000);
    }
  });

  it('shows images to the model, in each provider\'s format', async () => {
    const images = [{ mediaType: 'image/png' as const, data: 'iVBORw0K' }], messages = [{ role: 'user' as const, content: 'Regarde', images }];
    const a = reply({ content: [{ type: 'text', text: 'ok' }] });
    await complete('anthropic', { apiKey: 'k' }, { model: 'm', system: 'S', messages }, a as never);
    expect(call(a).body.messages[0].content).toEqual([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0K' } }, { type: 'text', text: 'Regarde' }]);
    const g = reply({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
    await complete('google', { apiKey: 'k' }, { model: 'm', system: 'S', messages }, g as never);
    expect(call(g).body.contents[0].parts).toEqual([{ inline_data: { mime_type: 'image/png', data: 'iVBORw0K' } }, { text: 'Regarde' }]);
    for (const [id, url] of [['openai', { url: 'data:image/png;base64,iVBORw0K' }], ['openrouter', { url: 'data:image/png;base64,iVBORw0K' }], ['mistral', 'data:image/png;base64,iVBORw0K']] as const) {
      const o = reply({ choices: [{ message: { content: 'ok' } }] });
      await complete(id, { apiKey: 'k' }, { model: 'm', system: 'S', messages }, o as never);
      expect(call(o).body.messages[1].content).toEqual([{ type: 'text', text: 'Regarde' }, { type: 'image_url', image_url: url }]);
    }
    // without images, messages stay plain text
    const t = reply({ choices: [{ message: { content: 'ok' } }] });
    await complete('openai', { apiKey: 'k' }, { model: 'm', system: 'S', messages: [{ role: 'user', content: 'U' }] }, t as never);
    expect(call(t).body.messages[1]).toEqual({ role: 'user', content: 'U' });
  });

  it('asks Gemini for JSON with its own message format', async () => {
    const f = reply({ candidates: [{ content: { parts: [{ text: '{"c":3}' }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2 } });
    expect(await complete('google', { apiKey: 'k' }, { model: 'gemini-x', system: 'S', messages: [{ role: 'user', content: 'U' }, { role: 'assistant', content: 'A' }], json }, f as never)).toEqual({ ok: true, text: '{"c":3}', usage: { inputTokens: 1, outputTokens: 2 } });
    const c = call(f);
    expect(c.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent');
    expect(c.body.contents.map((x: { role: string }) => x.role)).toEqual(['user', 'model']);
    expect(c.body.generationConfig.responseMimeType).toBe('application/json');
  });

  it('talks to a local server without a key or response_format', async () => {
    const f = reply({ choices: [{ message: { content: 'ok' } }] });
    await complete('openai-compatible', { baseUrl: 'http://localhost:11434/v1' }, { model: 'llama', system: 'S', messages: [], json }, f as never);
    expect(call(f).url).toBe('http://localhost:11434/v1/chat/completions');
    expect(call(f).body.response_format).toBeUndefined();
  });

  it('reports failures plainly', async () => {
    expect(await complete('openai', { apiKey: 'k' }, { model: 'm', system: '', messages: [] }, reply({}, 429) as never)).toEqual({ ok: false, status: 429, error: 'trop de requêtes : réessayez plus tard' });
    expect(await complete('openai', { apiKey: 'k' }, { model: 'm', system: '', messages: [] }, reply({ choices: [] }) as never)).toEqual({ ok: false, error: 'réponse vide du modèle' });
    expect(await complete('fish-audio', { apiKey: 'k' }, { model: 'm', system: '', messages: [] }, reply({}) as never)).toMatchObject({ ok: false });
    expect(await complete('openai', { apiKey: 'k' }, { model: '', system: '', messages: [] }, reply({}) as never)).toMatchObject({ ok: false, error: expect.stringContaining('modèle') });
  });
});
