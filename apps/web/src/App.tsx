// Layouts and routes.
//   AppLayout    a sidebar (search, the community, create, my space, the account) around the page: home, projects,
//                community, providers, team, profile. Signed out, only the community is there, with a way in.
//   FocusLayout  the editor and a generation take the whole window: their own bar, no global navigation.
//   AuthLayout   signing in and up, beside a presentation of the app.
import { useEffect, useState } from 'react';
import { BrowserRouter, Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router';
import { ROLE_LABEL } from './api';
import { CreateProvider, useCreate } from './components/Create';
import { Icon, type IconName } from './components/Icon';
import { Menu, UIProvider } from './components/ui';
import { Loading, Storyboard } from './components/Motion';
import { Forgot, Invite, Login, Reset, Signup } from './pages/Auth';
import { AuthorPage, Community, PublicationPage } from './pages/Community';
import { Editor } from './pages/Editor';
import { Generate } from './pages/Generate';
import { Home } from './pages/Home';
import { CreatePage } from './pages/CreatePage';
import { Profile } from './pages/Profile';
import { Projects } from './pages/Projects';
import { Settings } from './pages/Settings';
import { Team } from './pages/Team';
import { SessionProvider, useSession } from './session';
import { useTheme, type ThemeChoice } from './theme';

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

/** the theme as a list: one line per choice (menus, the sidebar: never too wide) */
export function ThemeList() {
  const { choice, set } = useTheme();
  const opts: [ThemeChoice, IconName, string][] = [['light', 'sun', 'Clair'], ['dark', 'moon', 'Sombre'], ['system', 'monitor', 'Automatique']];
  return (
    <div className="theme-list" role="group" aria-label="thème">
      {opts.map(([c, icon, label]) => <button key={c} type="button" aria-pressed={choice === c} onClick={() => set(c)}><Icon name={icon} size={16} /> {label}<Icon name="check" size={15} className="tick" /></button>)}
    </div>
  );
}

/** light / dark / as the system says */
export function ThemeSwitch({ compact = false }: { compact?: boolean }) {
  const { choice, set } = useTheme();
  const opts: [ThemeChoice, IconName, string][] = [['light', 'sun', 'Clair'], ['dark', 'moon', 'Sombre'], ['system', 'monitor', 'Auto']];
  return (
    <div className={`segmented${compact ? ' compact' : ''}`} role="group" aria-label="thème">
      {opts.map(([c, icon, label]) => <button key={c} type="button" aria-pressed={choice === c} onClick={() => set(c)} title={`Thème : ${label.toLowerCase()}`} aria-label={compact ? label : undefined}><Icon name={icon} size={15} />{!compact && ` ${label}`}</button>)}
    </div>
  );
}

function Brand({ to = '/' }: { to?: string }) {
  return <NavLink to={to} className="brand"><span className="logo" aria-hidden><Icon name="play" /></span> animation-flow</NavLink>;
}

/** the sidebar's search: it searches the community */
function SideSearch({ onDone }: { onDone?: () => void }) {
  const nav = useNavigate(), loc = useLocation();
  const [q, setQ] = useState(() => (loc.pathname === '/c' ? new URLSearchParams(loc.search).get('q') ?? '' : ''));
  return (
    <form role="search" className="side-search" onSubmit={(e) => { e.preventDefault(); nav(`/c${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`); onDone?.(); }}>
      <Icon name="search" size={16} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher des films…" aria-label="rechercher dans la communauté" />
      <kbd>↵</kbd>
    </form>
  );
}

function Item({ to, icon, children, end, onClick }: { to: string; icon: IconName; children: React.ReactNode; end?: boolean; onClick?: () => void }) {
  const loc = useLocation(), [path, query] = to.split('?') as [string, string | undefined];
  const sort = new URLSearchParams(loc.search).get('sort');
  // the community's sorts are pages of their own in the sidebar
  const active = query ? loc.pathname === path && `?${query}` === loc.search
    : path === '/c' ? loc.pathname === '/c' && !sort
    : end ? loc.pathname === path : loc.pathname === path || loc.pathname.startsWith(`${path}/`);
  return <Link to={to} onClick={onClick} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}><Icon name={icon} size={18} /> <span>{children}</span></Link>;
}

function AccountMenu() {
  const { me, workspace, signOut } = useSession();
  if (!me?.user) return null;
  return (
    <Menu label={`compte de ${me.user.name}`} align="left" trigger={
      <span className="account"><span className="avatar" aria-hidden>{initials(me.user.name)}</span><span className="who"><strong>{me.user.name}</strong><span className="muted small">{workspace ? `${workspace.name} · ${ROLE_LABEL[workspace.role]}` : me.user.email}</span></span><Icon name="more" size={16} /></span>
    }>
      {(close) => <>
        <div className="who"><strong>{me.user!.name}</strong><span className="muted small">{me.user!.email}</span></div>
        <NavLink to="/profile" role="menuitem" onClick={close}><Icon name="user" /> Profil</NavLink>
        <div className="label">Thème</div>
        <ThemeList />
        <button role="menuitem" onClick={() => void signOut()}><Icon name="logout" /> Se déconnecter</button>
      </>}
    </Menu>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { me, workspace, switchTo, can } = useSession(), create = useCreate(), at = useLocation().pathname;
  const signedIn = !!me?.user;
  const go = onNavigate;
  return (
    <nav className="sidebar" aria-label="navigation">
      <div className="side-top"><Brand to={signedIn ? '/' : '/c'} /></div>
      <SideSearch onDone={go} />
      {signedIn && workspace && can('editor') && (
        <div className="side-create">
          <button className="cta" onClick={() => { create.withAI(); go?.(); }}><Icon name="sparkles" size={17} /> Créer avec l'IA</button>
          <button onClick={() => { create.newProject(); go?.(); }} aria-label="nouveau projet" title="nouveau projet"><Icon name="plus" size={17} /></button>
        </div>
      )}
      <div className="side-section">
        <span className="side-label">Découvrir</span>
        {signedIn && <Item to="/" icon="home" end onClick={go}>Accueil</Item>}
        <Item to="/c" icon="globe" onClick={go}>Communauté</Item>
        <Item to="/c?sort=popular" icon="trending" onClick={go}>Populaires</Item>
        <Item to="/c?sort=remixed" icon="remix" onClick={go}>Plus remixés</Item>
      </div>
      {signedIn && workspace && (
        <div className="side-section">
          <span className="side-label">Mon espace</span>
          <Item to="/projects" icon="folder" onClick={go}>Mes projets</Item>
          <Item to="/settings" icon="key" onClick={go}>Fournisseurs</Item>
          <Item to="/team" icon="users" onClick={go}>Équipe</Item>
        </div>
      )}
      <span className="spacer" />
      {signedIn ? (
        <div className="side-bottom">
          {me!.workspaces.length > 1 && (
            <select className="ws-switch" value={workspace?.id ?? ''} onChange={(e) => switchTo(e.target.value)} aria-label="espace de travail">
              {me!.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name} · {ROLE_LABEL[w.role]}</option>)}
            </select>
          )}
          {me!.workspaces.length === 1 && <select className="ws-switch sr-only" value={workspace?.id ?? ''} onChange={(e) => switchTo(e.target.value)} aria-label="espace de travail">{me!.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name} · {ROLE_LABEL[w.role]}</option>)}</select>}
          <AccountMenu />
        </div>
      ) : (
        <div className="side-join card">
          <strong>Rejoignez la communauté</strong>
          <span className="muted small">Créez vos films avec l'IA, remixez ceux des autres.</span>
          <NavLink to="/login" state={{ from: at }} className="button primary-link">Se connecter</NavLink>
          {(me?.signup === 'open' || me?.setup) && <NavLink to="/signup" className="button">Créer un compte</NavLink>}
          <span className="side-label">Thème</span>
          <ThemeList />
        </div>
      )}
    </nav>
  );
}

function AppLayout() {
  const [drawer, setDrawer] = useState(false), loc = useLocation();
  useEffect(() => { setDrawer(false); }, [loc.pathname, loc.search]);
  return (
    <div className={`app-layout${drawer ? ' drawer-open' : ''}`}>
      <header className="mobile-bar">
        <button className="icon ghost" onClick={() => setDrawer(true)} aria-label="ouvrir le menu"><Icon name="menu" /></button>
        <Brand />
      </header>
      <div className="side-wrap">
        <Sidebar onNavigate={() => setDrawer(false)} />
      </div>
      {drawer && <div className="scrim" onClick={() => setDrawer(false)} aria-hidden />}
      <main className="app-main"><div className="scrub" aria-hidden><i /></div><Outlet /></main>
    </div>
  );
}

function FocusLayout() {
  return <div className="focus-layout"><Outlet /></div>;
}

function AuthLayout() {
  return (
    <div className="auth-layout">
      <aside className="auth-art">
        <span className="brand"><span className="logo" aria-hidden><Icon name="play" /></span> animation-flow</span>
        <div>
          <h1>Du texte à l'animation, en quelques minutes.</h1>
          <p>Décrivez votre idée : l'IA écrit le storyboard, dessine chaque personnage et chaque décor, compose la musique, puis anime les scènes. Partagez vos films, remixez ceux des autres.</p>
          <ul>
            <li><span className="dot"><Icon name="sparkles" size={15} /></span> Storyboard, dessins, musique et bruitages faits pour votre film</li>
            <li><span className="dot"><Icon name="globe" size={15} /></span> Une communauté où chaque film se remixe</li>
            <li><span className="dot"><Icon name="users" size={15} /></span> Édition à plusieurs, en temps réel</li>
          </ul>
        </div>
        <Storyboard />
        <NavLink to="/c" className="auth-explore"><Icon name="globe" size={15} /> Explorer la communauté sans compte</NavLink>
      </aside>
      <div className="auth-side">
        <div className="auth-theme"><ThemeSwitch /></div>
        <Outlet />
      </div>
    </div>
  );
}

function NoWorkspace() {
  return <div className="page"><div className="empty"><h2>Aucun espace de travail</h2><p>Vous ne faites partie d'aucune équipe pour l'instant. Ouvrez un lien d'invitation, ou explorez la communauté en attendant.</p><NavLink to="/c" className="button">Explorer la communauté</NavLink></div></div>;
}
const NotFound = () => <div className="page"><div className="empty"><h2>Page introuvable</h2><NavLink to="/" className="button">Revenir à l'accueil</NavLink></div></div>;

function Shell() {
  const { me, loading, workspace, epoch } = useSession();
  const at = useLocation().pathname;
  if (loading) return <Loading />;
  const community = <>
    <Route path="/c" element={<Community />} />
    <Route path="/c/:id" element={<PublicationPage />} />
    <Route path="/u/:id" element={<AuthorPage />} />
  </>;
  if (!me?.user) {
    return (
      <Routes>
        <Route element={<AppLayout />}>{community}</Route>
        <Route element={<AuthLayout />}>
          <Route path="/invite/:token" element={<Invite />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/login" element={<Login />} />
          <Route path="/forgot" element={<Forgot />} />
          <Route path="/reset/:token" element={<Reset />} />
          <Route path="*" element={<Navigate to={me?.setup ? '/signup' : '/login'} replace state={{ from: at }} />} />
        </Route>
      </Routes>
    );
  }
  return (
    <Routes key={epoch}>
      {workspace && (
        <Route element={<FocusLayout />}>
          <Route path="/p/:id" element={<Editor />} />
          <Route path="/g/:id" element={<Generate />} />
        </Route>
      )}
      <Route element={<AppLayout />}>
        {community}
        <Route path="/profile" element={<Profile />} />
        <Route path="/invite/:token" element={<Invite />} />
        {workspace ? <>
          <Route path="/" element={<Home />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/create" element={<CreatePage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/team" element={<Team />} />
          <Route path="/reset/:token" element={<Reset />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="/signup" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </> : <Route path="*" element={<NoWorkspace />} />}
      </Route>
    </Routes>
  );
}

export function App() {
  return <BrowserRouter><SessionProvider><UIProvider><CreateProvider><Shell /></CreateProvider></UIProvider></SessionProvider></BrowserRouter>;
}
