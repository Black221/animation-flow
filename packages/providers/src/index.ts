// Model providers. The application depends on no single vendor: each workspace registers its own API keys, and picks
// a model per task. This module only knows how to talk to each provider (catalogue, key check, model list); keys are
// stored encrypted by the API and handed in at call time. Nothing here logs or returns a key.

export type ProviderKind = 'llm' | 'tts';
/** how a provider can return JSON that matches our schema */
export type StructuredOutput = 'native' | 'json-mode' | 'unknown';

export interface ProviderInfo {
  id: string;
  label: string;
  kinds: ProviderKind[];
  /** where keys are made */
  keyUrl: string;
  keyHint: string;
  /** a local server (Ollama, LM Studio, vLLM) may not need a key */
  keyOptional?: boolean;
  /** the user must give the server address */
  needsBaseUrl?: boolean;
  defaultBaseUrl?: string;
  structuredOutput: StructuredOutput;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', kinds: ['llm'], keyUrl: 'https://console.anthropic.com/settings/keys', keyHint: 'sk-ant-…', defaultBaseUrl: 'https://api.anthropic.com', structuredOutput: 'native' },
  { id: 'openai', label: 'OpenAI', kinds: ['llm', 'tts'], keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-…', defaultBaseUrl: 'https://api.openai.com/v1', structuredOutput: 'native' },
  { id: 'google', label: 'Google (Gemini)', kinds: ['llm'], keyUrl: 'https://aistudio.google.com/apikey', keyHint: 'AIza…', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', structuredOutput: 'native' },
  { id: 'mistral', label: 'Mistral AI', kinds: ['llm'], keyUrl: 'https://console.mistral.ai/api-keys', keyHint: 'clé Mistral', defaultBaseUrl: 'https://api.mistral.ai/v1', structuredOutput: 'json-mode' },
  { id: 'openrouter', label: 'OpenRouter (plusieurs fournisseurs)', kinds: ['llm'], keyUrl: 'https://openrouter.ai/keys', keyHint: 'sk-or-…', defaultBaseUrl: 'https://openrouter.ai/api/v1', structuredOutput: 'unknown' },
  { id: 'openai-compatible', label: 'Serveur compatible OpenAI (Ollama, LM Studio, vLLM…)', kinds: ['llm'], keyUrl: 'https://github.com/ollama/ollama/blob/main/docs/openai.md', keyHint: 'souvent inutile en local', keyOptional: true, needsBaseUrl: true, defaultBaseUrl: 'http://localhost:11434/v1', structuredOutput: 'unknown' },
  { id: 'fish-audio', label: 'Fish Audio', kinds: ['tts'], keyUrl: 'https://fish.audio/app/api-keys/', keyHint: 'clé Fish Audio', defaultBaseUrl: 'https://api.fish.audio', structuredOutput: 'unknown' },
  { id: 'elevenlabs', label: 'ElevenLabs', kinds: ['tts'], keyUrl: 'https://elevenlabs.io/app/settings/api-keys', keyHint: 'clé ElevenLabs', defaultBaseUrl: 'https://api.elevenlabs.io', structuredOutput: 'unknown' },
];
export const providerById = (id: string) => PROVIDERS.find((p) => p.id === id);

export interface TaskInfo { id: string; kind: ProviderKind; label: string; description: string }
/** what a model is chosen for; each task gets its own key + model */
export const TASKS: TaskInfo[] = [
  { id: 'storyboard', kind: 'llm', label: 'Texte → storyboard', description: 'Découpe un script ou une idée en scènes, répliques et intentions de plan.' },
  { id: 'scenes', kind: 'llm', label: 'Storyboard → scènes', description: "Écrit le format d'animation (JSON validé) de chaque scène." },
  { id: 'narration', kind: 'tts', label: 'Narration (voix)', description: 'Synthétise la voix off, une réplique à la fois.' },
];
export const taskById = (id: string) => TASKS.find((t) => t.id === id);

export interface CredentialInput { apiKey?: string | undefined; baseUrl?: string | undefined }
export interface ModelInfo { id: string; label: string }
export type TestResult = { ok: true; models: ModelInfo[] } | { ok: false; status?: number; error: string };
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const trimSlash = (s: string) => s.replace(/\/+$/, '');
const bearer = (key?: string): Record<string, string> => (key ? { Authorization: `Bearer ${key}` } : {});

interface Probe { url: string; headers: Record<string, string>; models: (body: any) => ModelInfo[] }
function probe(p: ProviderInfo, c: CredentialInput): Probe {
  const base = trimSlash(c.baseUrl || p.defaultBaseUrl || ''), key = c.apiKey ?? '';
  const ids = (list: unknown, pick: (m: any) => ModelInfo | null) => (Array.isArray(list) ? list.map(pick).filter((m): m is ModelInfo => !!m) : []);
  switch (p.id) {
    case 'anthropic':
      return { url: `${base}/v1/models?limit=100`, headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, models: (b) => ids(b?.data, (m) => (m?.id ? { id: m.id, label: m.display_name ?? m.id } : null)) };
    case 'google':
      return {
        url: `${base}/models?pageSize=200`, headers: { 'x-goog-api-key': key },
        models: (b) => ids(b?.models, (m) => (m?.name && (!m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent')) ? { id: String(m.name).replace(/^models\//, ''), label: m.displayName ?? m.name } : null)),
      };
    case 'fish-audio':
      return { url: `${base}/model?page_size=50&self=true`, headers: bearer(key), models: (b) => ids(b?.items, (m) => (m?._id ? { id: m._id, label: m.title ?? m._id } : null)) };
    case 'elevenlabs':
      return { url: `${base}/v1/voices`, headers: { 'xi-api-key': key }, models: (b) => ids(b?.voices, (m) => (m?.voice_id ? { id: m.voice_id, label: m.name ?? m.voice_id } : null)) };
    default: // openai, mistral, openrouter, openai-compatible: GET /models
      return { url: `${base}/models`, headers: bearer(key), models: (b) => ids(b?.data, (m) => (m?.id ? { id: m.id, label: m.name ?? m.id } : null)) };
  }
}

/** Is this key accepted, and which models / voices does it give access to? */
export async function testCredential(providerId: string, c: CredentialInput, fetchImpl: FetchLike = fetch as unknown as FetchLike, timeoutMs = 15000): Promise<TestResult> {
  const p = providerById(providerId);
  if (!p) return { ok: false, error: `fournisseur inconnu : ${providerId}` };
  if (!c.apiKey && !p.keyOptional) return { ok: false, error: 'clé manquante' };
  if (p.needsBaseUrl && !c.baseUrl) return { ok: false, error: 'adresse du serveur manquante' };
  const pr = probe(p, c);
  try {
    // OpenRouter lists models without a key: check the key itself first
    if (p.id === 'openrouter') {
      const k = await fetchImpl(`${trimSlash(c.baseUrl || p.defaultBaseUrl!)}/key`, { headers: bearer(c.apiKey), signal: AbortSignal.timeout(timeoutMs) });
      if (!k.ok) return { ok: false, status: k.status, error: describeStatus(k.status) };
    }
    const r = await fetchImpl(pr.url, { method: 'GET', headers: pr.headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { ok: false, status: r.status, error: describeStatus(r.status) };
    const models = pr.models(await r.json()).sort((a, b) => a.id.localeCompare(b.id));
    return { ok: true, models };
  } catch (e) {
    const name = (e as Error)?.name;
    return { ok: false, error: name === 'TimeoutError' || name === 'AbortError' ? 'pas de réponse du fournisseur (délai dépassé)' : 'fournisseur injoignable' };
  }
}

export function describeStatus(status: number): string {
  if (status === 401 || status === 403) return 'clé refusée par le fournisseur';
  if (status === 402) return 'crédit insuffisant sur ce compte';
  if (status === 404) return "adresse introuvable : vérifiez l'URL du serveur";
  if (status === 429) return 'trop de requêtes : réessayez plus tard';
  if (status >= 500) return 'erreur du fournisseur';
  return `réponse inattendue (HTTP ${status})`;
}

/** what the interface shows instead of the key */
export const maskKey = (key: string | undefined) => (!key ? '' : key.length >= 12 ? `…${key.slice(-4)}` : '…');
