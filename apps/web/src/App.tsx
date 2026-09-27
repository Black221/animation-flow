import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router';
import { ROLE_LABEL } from './api';
import { Invite, Login, Signup } from './pages/Auth';
import { Editor } from './pages/Editor';
import { Generate } from './pages/Generate';
import { Profile } from './pages/Profile';
import { Projects } from './pages/Projects';
import { Settings } from './pages/Settings';
import { Team } from './pages/Team';
import { SessionProvider, useSession } from './session';

function Shell() {
  const { me, loading, workspace, switchTo, signOut, epoch } = useSession();
  const at = useLocation().pathname;
  if (loading) return <div className="page muted">Chargement…</div>;
  if (!me?.user) {
    return (
      <>
      <p className="brand auth-brand"><span className="logo" aria-hidden>◉</span> animation-flow</p>
      <Routes>
        <Route path="/invite/:token" element={<Invite />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to={me?.setup ? '/signup' : '/login'} replace state={{ from: at }} />} />
      </Routes>
      </>
    );
  }
  return (
    <>
      <header className="topbar">
        <NavLink to="/" className="brand"><span className="logo" aria-hidden>◉</span> animation-flow</NavLink>
        <nav>
          <NavLink to="/" end>Projets</NavLink>
          <NavLink to="/settings">Fournisseurs</NavLink>
          <NavLink to="/team">Équipe</NavLink>
        </nav>
        <span className="spacer" />
        {me.workspaces.length > 0 && (
          <select className="ws-switch" value={workspace?.id ?? ''} onChange={(e) => switchTo(e.target.value)} aria-label="espace de travail">
            {me.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name} · {ROLE_LABEL[w.role]}</option>)}
          </select>
        )}
        <NavLink to="/profile" className="me" title={me.user.email}>{me.user.name}</NavLink>
        <button className="ghost small" onClick={() => void signOut()}>Se déconnecter</button>
      </header>
      <main key={epoch}>
        {!workspace ? (
          <Routes>
            <Route path="/invite/:token" element={<Invite />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="*" element={<NoWorkspace />} />
          </Routes>
        ) : (
          <Routes>
            <Route path="/" element={<Projects />} />
            <Route path="/p/:id" element={<Editor />} />
            <Route path="/g/:id" element={<Generate />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/team" element={<Team />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/invite/:token" element={<Invite />} />
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="/signup" element={<Navigate to="/" replace />} />
            <Route path="*" element={<div className="page"><h2>Page introuvable</h2></div>} />
          </Routes>
        )}
      </main>
    </>
  );
}

function NoWorkspace() {
  return <div className="page"><h2>Aucun espace de travail</h2><p className="muted">Vous ne faites partie d'aucune équipe pour l'instant. Ouvrez un lien d'invitation, ou créez un espace depuis la page Équipe d'un autre compte.</p></div>;
}

export function App() {
  return <BrowserRouter><SessionProvider><Shell /></SessionProvider></BrowserRouter>;
}
