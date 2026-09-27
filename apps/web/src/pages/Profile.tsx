import { useState, type FormEvent } from 'react';
import { Api } from '../api';
import { useSession } from '../session';

export function Profile() {
  const { me, refresh } = useSession();
  const [name, setName] = useState(me?.user?.name ?? ''), [current, setCurrent] = useState(''), [next, setNext] = useState('');
  const [msg, setMsg] = useState(''), [error, setError] = useState('');
  const save = async (e: FormEvent, body: Parameters<typeof Api.updateMe>[0], done: string) => {
    e.preventDefault(); setMsg(''); setError('');
    try { await Api.updateMe(body); await refresh(); setMsg(done); setCurrent(''); setNext(''); } catch (err) { setError((err as Error).message); }
  };
  return (
    <div className="page profile">
      <h2>Profil</h2>
      <p className="muted small">{me?.user?.email}</p>
      {msg && <p className="ok small" role="status">{msg}</p>}
      {error && <p className="error small" role="alert">{error}</p>}
      <form className="card form" onSubmit={(e) => void save(e, { name: name.trim() }, 'Nom enregistré.')}>
        <label>Nom <input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <button type="submit">Enregistrer</button>
      </form>
      <form className="card form" onSubmit={(e) => void save(e, { password: { current, next } }, 'Mot de passe changé. Vos autres sessions sont fermées.')} aria-label="mot de passe">
        <label>Mot de passe actuel <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>
        <label>Nouveau mot de passe (10 caractères au moins) <input type="password" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} required /></label>
        <button type="submit">Changer le mot de passe</button>
      </form>
    </div>
  );
}
