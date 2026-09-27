// Model providers: the user brings their own API keys (one or several per provider) and picks a model per task.
// A key is typed once, sent to the server, sealed there, and never shown again: only its last characters.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Api, type Assignment, type Credential, type ProviderInfo, type TaskInfo, type TestResult } from '../api';

function AddKey({ providers, onAdded }: { providers: ProviderInfo[]; onAdded: () => void }) {
  const [provider, setProvider] = useState(providers[0]?.id ?? '');
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [error, setError] = useState('');
  const p = providers.find((x) => x.id === provider);
  useEffect(() => { setBaseUrl(p?.needsBaseUrl ? p.defaultBaseUrl ?? '' : ''); }, [p]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await Api.addCredential({ provider, label: label.trim() || p?.label || provider, ...(apiKey ? { apiKey } : {}), ...(baseUrl ? { baseUrl } : {}) });
      setApiKey(''); setLabel(''); setError(''); onAdded();
    } catch (err) { setError((err as Error).message); }
  };
  return (
    <form className="card form" onSubmit={submit} aria-label="ajouter une clé">
      <h3>Ajouter une clé</h3>
      <label>Fournisseur <select value={provider} onChange={(e) => setProvider(e.target.value)}>{providers.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
      <label>Nom <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="perso, labo…" /></label>
      <label>Clé d'API {p?.keyOptional && <span className="muted small">(facultative)</span>}
        <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={p?.keyHint} />
      </label>
      {p?.needsBaseUrl && <label>Adresse du serveur <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={p.defaultBaseUrl} /></label>}
      <p className="muted small">La clé est chiffrée sur le serveur et ne sera plus jamais affichée. {p && <a href={p.keyUrl} target="_blank" rel="noreferrer">Où obtenir une clé ?</a>}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={!p || (!apiKey && !p.keyOptional)}>Ajouter</button>
    </form>
  );
}

export function Settings() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [creds, setCreds] = useState<Credential[]>([]);
  const [assign, setAssign] = useState<Assignment[]>([]);
  const [tests, setTests] = useState<Record<string, TestResult | 'pending'>>({});
  const [error, setError] = useState('');
  const refresh = () => Promise.all([Api.credentials().then(setCreds), Api.assignments().then(setAssign)]).catch((e) => setError(e.message));
  useEffect(() => { Api.providers().then((r) => { setProviders(r.providers); setTasks(r.tasks); }).catch((e) => setError(e.message)); void refresh(); }, []);
  const byId = useMemo(() => Object.fromEntries(providers.map((p) => [p.id, p])), [providers]);

  const test = async (c: Credential) => {
    setTests((t) => ({ ...t, [c.id]: 'pending' }));
    const r = await Api.testCredential(c.id).catch((e) => ({ ok: false as const, error: (e as Error).message }));
    setTests((t) => ({ ...t, [c.id]: r })); void refresh();
  };
  const replace = async (c: Credential) => {
    const k = prompt(`Nouvelle clé pour « ${c.label} » :`);
    if (k?.trim()) { await Api.updateCredential(c.id, { apiKey: k.trim() }).catch((e) => setError(e.message)); void refresh(); }
  };
  const remove = async (c: Credential) => {
    if (!confirm(`Supprimer la clé « ${c.label} » ? Les tâches qui l'utilisent n'auront plus de modèle.`)) return;
    await Api.deleteCredential(c.id).catch((e) => setError(e.message)); void refresh();
  };
  const setTask = async (task: string, credentialId: string | null, model: string) => {
    try { const a = await Api.assign(task, credentialId, model); setAssign((all) => all.map((x) => (x.task === task ? a : x))); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="page settings">
      <h2>Fournisseurs de modèles</h2>
      <p className="muted">Utilisez vos propres clés : Anthropic, OpenAI, Google, Mistral, OpenRouter, un serveur local compatible OpenAI (Ollama, LM Studio), et pour la voix Fish Audio ou ElevenLabs. Vous choisissez ensuite un modèle par tâche.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="grid2">
        <section>
          <h3>Vos clés</h3>
          {creds.length === 0 && <p className="muted">Aucune clé enregistrée.</p>}
          <ul className="cred-list">
            {creds.map((c) => {
              const t = tests[c.id];
              return (
                <li key={c.id} className="card" data-testid="credential">
                  <div className="row">
                    <strong>{c.label}</strong>
                    <span className="muted small">{byId[c.provider]?.label ?? c.provider}</span>
                    <code className="hint">{c.hint || (c.baseUrl ?? 'sans clé')}</code>
                    <span className={`badge ${c.lastTestOk === true ? 'ok' : c.lastTestOk === false ? 'warn' : ''}`}>{c.lastTestOk === true ? 'valide' : c.lastTestOk === false ? 'refusée' : 'non testée'}</span>
                  </div>
                  <div className="row">
                    <button onClick={() => void test(c)} disabled={t === 'pending'}>{t === 'pending' ? 'Test…' : 'Tester'}</button>
                    <button onClick={() => void replace(c)}>Remplacer la clé</button>
                    <button className="ghost" onClick={() => void remove(c)}>Supprimer</button>
                  </div>
                  {t && t !== 'pending' && (t.ok ? <p className="ok small">{t.models.length} modèle(s) disponible(s)</p> : <p className="error small">{t.error}</p>)}
                </li>
              );
            })}
          </ul>
          {providers.length > 0 && <AddKey providers={providers} onAdded={() => void refresh()} />}
        </section>
        <section>
          <h3>Un modèle par tâche</h3>
          {tasks.map((task) => {
            const a = assign.find((x) => x.task === task.id) ?? { task: task.id, credentialId: null, model: '' };
            const usable = creds.filter((c) => byId[c.provider]?.kinds.includes(task.kind));
            const t = a.credentialId ? tests[a.credentialId] : undefined, models = t && t !== 'pending' && t.ok ? t.models : [];
            return (
              <div key={task.id} className="card form task">
                <strong>{task.label}</strong>
                <p className="muted small">{task.description}</p>
                <label>Clé
                  <select value={a.credentialId ?? ''} onChange={(e) => void setTask(task.id, e.target.value || null, a.model)}>
                    <option value="">— aucune —</option>
                    {usable.map((c) => <option key={c.id} value={c.id}>{c.label} ({byId[c.provider]?.label})</option>)}
                  </select>
                </label>
                <label>{task.kind === 'tts' ? 'Voix / modèle' : 'Modèle'}
                  <input list={`models-${task.id}`} defaultValue={a.model} key={a.credentialId + a.model} placeholder={models.length ? 'choisir dans la liste' : 'testez la clé pour voir la liste'} onBlur={(e) => e.target.value !== a.model && void setTask(task.id, a.credentialId, e.target.value.trim())} />
                  <datalist id={`models-${task.id}`}>{models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
                </label>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
