import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router';
import { Icon, type IconName } from './components/Icon';
import { useTheme, type ThemeChoice } from './theme';
import { ROLE_LABEL } from './api';
import { Forgot, Invite, Login, Reset, Signup } from './pages/Auth';
import { Editor } from './pages/Editor';
import { Generate } from './pages/Generate';
import { Profile } from './pages/Profile';
import { Projects } from './pages/Projects';
import { Settings } from './pages/Settings';
import { Team } from './pages/Team';
import { SessionProvider, useSession } from './session';

function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?'; }

/** light / dark / as the system says */
export function ThemeSwitch() {
  const { choice, set } = useTheme();
  const opts: [ThemeChoice, IconName, string][] = [['light', 'sun', 'Clair'], ['dark', 'moon', 'Sombre'], ['system', 'monitor', 'Auto']];
  return (
    <div className="segmented" role="group" aria-label="thème">
      {opts.map(([c, icon, label]) => <button key={c} type="button" aria-pressed={choice === c} onClick={() => set(c)} title={`Thème : ${label.toLowerCase()}`}><Icon name={icon} size={15} /> {label}</button>)}
    </div>
  );
}

/** a button that shows or hides a small menu under it, closed by a click outside or Escape */
function useMenu() {
  const [open, setOpen] = useState(false), ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return { open, setOpen, ref };
}

function UserMenu() {
  const { me, signOut } = useSession(), m = useMenu();
  if (!me?.user) return null;
  return (
    <div className="menu-wrap" ref={m.ref}>
      <button className="avatar-btn" aria-haspopup="menu" aria-expanded={m.open} aria-label={`compte de ${me.user.name}`} title={me.user.email} onClick={() => m.setOpen((o) => !o)}>
        <span className="avatar" aria-hidden>{initials(me.user.name)}</span>
      </button>
      {m.open && (
        <div className="menu" role="menu">
          <div className="who"><strong>{me.user.name}</strong><span className="muted small">{me.user.email}</span></div>
          <NavLink to="/profile" role="menuitem" onClick={() => m.setOpen(false)}><Icon name="user" /> Profil</NavLink>
          <div className="label">Thème</div>
          <ThemeSwitch />
          <button role="menuitem" onClick={() => void signOut()}><Icon name="logout" /> Se déconnecter</button>
        </div>
      )}
    </div>
  );
}

function Shell() {
  const { me, loading, workspace, switchTo, epoch } = useSession();
  const at = useLocation().pathname;
  if (loading) return <div className="page muted">Chargement…</div>;
  if (!me?.user) {
    return (
      <div className="auth-layout">
        <aside className="auth-art">
          <span className="brand"><span className="logo" aria-hidden><Icon name="play" /></span> animation-flow</span>
          <div>
            <h1>Du texte à l'animation, en quelques minutes.</h1>
            <p>Décrivez votre idée : l'IA écrit le storyboard, dessine chaque personnage et chaque décor, compose la musique, puis anime les scènes. Vous gardez la main sur tout.</p>
            <ul>
              <li><span className="dot"><Icon name="sparkles" size={15} /></span> Storyboard, dessins, musique et bruitages faits pour votre film</li>
              <li><span className="dot"><Icon name="mic" size={15} /></span> Voix off et personnages avec le fournisseur de votre choix</li>
              <li><span className="dot"><Icon name="users" size={15} /></span> Édition à plusieurs, en temps réel</li>
            </ul>
          </div>
          <span className="small" style={{ opacity: 0.6 }}>Vos clés d'API restent chiffrées sur votre serveur.</span>
        </aside>
        <div className="auth-side">
          <div className="auth-theme"><ThemeSwitch /></div>
          <Routes>
            <Route path="/invite/:token" element={<Invite />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/login" element={<Login />} />
            <Route path="/forgot" element={<Forgot />} />
            <Route path="/reset/:token" element={<Reset />} />
            <Route path="*" element={<Navigate to={me?.setup ? '/signup' : '/login'} replace state={{ from: at }} />} />
          </Routes>
        </div>
      </div>
    );
  }
  return (
    <>
      <header className="topbar">
        <NavLink to="/" className="brand"><span className="logo" aria-hidden><Icon name="play" /></span> animation-flow</NavLink>
        <nav>
          <NavLink to="/" end><Icon name="folder" /> <span>Projets</span></NavLink>
          <NavLink to="/settings"><Icon name="key" /> <span>Fournisseurs</span></NavLink>
          <NavLink to="/team"><Icon name="users" /> <span>Équipe</span></NavLink>
        </nav>
        <span className="spacer" />
        {me.workspaces.length > 0 && (
          <select className="ws-switch" value={workspace?.id ?? ''} onChange={(e) => switchTo(e.target.value)} aria-label="espace de travail">
            {me.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name} · {ROLE_LABEL[w.role]}</option>)}
          </select>
        )}
        <UserMenu />
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
            <Route path="/reset/:token" element={<Reset />} />
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
