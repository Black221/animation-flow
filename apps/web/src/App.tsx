import { useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router';
import { Api, onUnauthorized, setToken } from './api';
import { Editor } from './pages/Editor';
import { Generate } from './pages/Generate';
import { Projects } from './pages/Projects';
import { Settings } from './pages/Settings';

function Login({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="login">
      <form className="card" onSubmit={(e) => { e.preventDefault(); setToken(value.trim()); onDone(); }}>
        <h2>Jeton d'accès</h2>
        <p className="muted">Ce serveur est protégé par un jeton partagé par l'équipe (variable <code>APP_ACCESS_TOKEN</code>). Il reste dans ce navigateur.</p>
        <input type="password" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="jeton" aria-label="jeton d'accès" />
        <button className="primary" type="submit" disabled={!value.trim()}>Entrer</button>
      </form>
    </div>
  );
}

export function App() {
  const [locked, setLocked] = useState(false);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => onUnauthorized(() => setLocked(true)), []);
  useEffect(() => { Api.projects().catch(() => undefined); }, [epoch]);
  if (locked) return <Login onDone={() => { setLocked(false); setEpoch((e) => e + 1); }} />;
  return (
    <BrowserRouter>
      <header className="topbar">
        <NavLink to="/" className="brand"><span className="logo" aria-hidden>◉</span> animation-flow</NavLink>
        <nav>
          <NavLink to="/" end>Projets</NavLink>
          <NavLink to="/settings">Fournisseurs</NavLink>
        </nav>
      </header>
      <main key={epoch}>
        <Routes>
          <Route path="/" element={<Projects />} />
          <Route path="/p/:id" element={<Editor />} />
          <Route path="/g/:id" element={<Generate />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<div className="page"><h2>Page introuvable</h2></div>} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
