// The back office: sign in (platform admins only), then a control room — a sidebar of sections, each a page.
import { Icon, type IconName, Menu, setTheme, UIProvider, useTheme, useUI } from '@af/ui';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router';
import { Api, onSignedOut, type Admin } from './api';
import { Audit } from './pages/Audit';
import { Dashboard } from './pages/Dashboard';
import { Films, Moderation } from './pages/Community';
import { Plans, Subscriptions } from './pages/Billing';
import { UserPage, Users } from './pages/Users';
import { WorkspacePage, Workspaces } from './pages/Workspaces';

interface Session { admin: Admin | null; appUrl: string | null; signOut: () => Promise<void>; counts: { reports: number; pastDue: number }; refreshCounts: () => void }
const Ctx = createContext<Session>({ admin: null, appUrl: null, signOut: async () => undefined, counts: { reports: 0, pastDue: 0 }, refreshCounts: () => undefined });
export const useAdmin = () => useContext(Ctx);

const SECTIONS: { label: string; items: [string, IconName, string, ('reports' | 'pastDue')?][] }[] = [
  { label: 'Pilotage', items: [['/', 'gauge', 'Tableau de bord']] },
  { label: 'Comptes', items: [['/users', 'user', 'Utilisateurs'], ['/workspaces', 'folder', 'Espaces']] },
  { label: 'Revenus', items: [['/subscriptions', 'card', 'Abonnements', 'pastDue'], ['/plans', 'sliders', 'Plans']] },
  { label: 'Communauté', items: [['/moderation', 'flag', 'Modération', 'reports'], ['/films', 'film', 'Films publiés']] },
  { label: 'Sécurité', items: [['/audit', 'shield', 'Journal']] },
];

function ThemeButton() {
  const t = useTheme();
  const next = t.choice === 'system' ? 'light' : t.choice === 'light' ? 'dark' : 'system';
  return <button className="icon ghost" onClick={() => setTheme(next)} aria-label={`thème : ${{ system: 'automatique', light: 'clair', dark: 'sombre' }[t.choice]}`} title="changer de thème"><Icon name={t.choice === 'system' ? 'monitor' : t.choice === 'light' ? 'sun' : 'moon'} size={17} /></button>;
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const at = useLocation().pathname, { counts, appUrl } = useAdmin();
  return (
    <nav className="bo-side" aria-label="back-office">
      <Link to="/" className="bo-brand" onClick={onNavigate}><span className="logo" aria-hidden><Icon name="shield" size={15} /></span><span>animation-flow<small>Back-office</small></span></Link>
      {SECTIONS.map((s) => (
        <div key={s.label} className="bo-section">
          <span className="bo-label">{s.label}</span>
          {s.items.map(([to, icon, label, count]) => {
            const active = to === '/' ? at === '/' : at === to || at.startsWith(`${to}/`), n = count ? counts[count] : 0;
            return <Link key={to} to={to} onClick={onNavigate} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}><Icon name={icon} size={17} /> <span>{label}</span>{n > 0 && <span className="count" aria-label={`${n} à traiter`}>{n}</span>}</Link>;
          })}
        </div>
      ))}
      <span className="spacer" />
      {appUrl && <a className="bo-app" href={appUrl} target="_blank" rel="noopener"><Icon name="play" size={14} /> Ouvrir l'application</a>}
    </nav>
  );
}

function Layout() {
  const { admin, signOut } = useAdmin(), [drawer, setDrawer] = useState(false), loc = useLocation();
  useEffect(() => setDrawer(false), [loc.pathname]);
  return (
    <div className={`bo-layout${drawer ? ' drawer-open' : ''}`}>
      <div className="bo-side-wrap"><Sidebar onNavigate={() => setDrawer(false)} /></div>
      <div className="scrim" onClick={() => setDrawer(false)} />
      <div className="bo-main">
        <header className="bo-top">
          <button className="icon ghost bo-menu" onClick={() => setDrawer(true)} aria-label="ouvrir le menu"><Icon name="menu" /></button>
          <span className="bo-env"><Icon name="shield" size={13} /> Administration de la plateforme</span>
          <span className="spacer" />
          <ThemeButton />
          <Menu label={`compte de ${admin?.name}`} trigger={<span className="account"><span className="avatar" aria-hidden>{admin?.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</span><span className="who hide-phone"><strong>{admin?.name}</strong><span className="muted small">{admin?.email}</span></span></span>}>
            {() => <>
              <div className="who"><strong>{admin?.name}</strong><span className="muted small">{admin?.email}</span><span className="muted small">Session du back-office : 12 h au plus</span></div>
              <button role="menuitem" onClick={() => void signOut()}><Icon name="logout" /> Se déconnecter</button>
            </>}
          </Menu>
        </header>
        <main className="bo-page"><Outlet /></main>
      </div>
    </div>
  );
}

function Login({ onIn }: { onIn: (a: Admin) => void }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setError('');
    try { onIn((await Api.login(email.trim(), password)).user); } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  return (
    <div className="bo-login">
      <form className="card" aria-label="connexion au back-office" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <span className="bo-brand"><span className="logo" aria-hidden><Icon name="shield" size={15} /></span><span>animation-flow<small>Back-office</small></span></span>
        <h1>Connexion</h1>
        <p className="muted small">Réservé aux administrateurs de la plateforme. Chaque action est inscrite au journal.</p>
        <label className="field">E-mail<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
        <label className="field">Mot de passe<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <div className="alert error" role="alert"><Icon name="alert" size={16} /><span>{error}</span></div>}
        <button className="primary" disabled={busy || !email || !password}>{busy ? 'Connexion…' : 'Se connecter'}</button>
      </form>
    </div>
  );
}

function Shell() {
  const [state, setState] = useState<{ admin: Admin | null; appUrl: string | null; loading: boolean }>({ admin: null, appUrl: null, loading: true });
  const [counts, setCounts] = useState({ reports: 0, pastDue: 0 });
  const nav = useNavigate(), ui = useUI();
  const load = () => Api.me().then((m) => setState({ admin: m.user, appUrl: m.appUrl ?? null, loading: false })).catch(() => setState((s) => ({ ...s, loading: false })));
  useEffect(() => { void load(); }, []);
  useEffect(() => onSignedOut(() => { setState((s) => ({ ...s, admin: null })); ui.toast('Session terminée : reconnectez-vous', 'info'); }), [ui]);
  const refreshCounts = () => { Api.overview().then((o) => setCounts({ reports: o.openReports, pastDue: o.pastDue })).catch(() => undefined); };
  useEffect(() => { if (state.admin) refreshCounts(); }, [state.admin]);
  if (state.loading) return null;
  if (!state.admin) return <Login onIn={(a) => { setState((s) => ({ ...s, admin: a })); void load(); nav('/'); }} />;
  const value: Session = { admin: state.admin, appUrl: state.appUrl, counts, refreshCounts, signOut: async () => { await Api.logout().catch(() => undefined); setState((s) => ({ ...s, admin: null })); } };
  return (
    <Ctx.Provider value={value}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/users" element={<Users />} />
          <Route path="/users/:id" element={<UserPage />} />
          <Route path="/workspaces" element={<Workspaces />} />
          <Route path="/workspaces/:id" element={<WorkspacePage />} />
          <Route path="/subscriptions" element={<Subscriptions />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/moderation" element={<Moderation />} />
          <Route path="/films" element={<Films />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Ctx.Provider>
  );
}

export function App() {
  return <BrowserRouter><UIProvider><Shell /></UIProvider></BrowserRouter>;
}

/** a page's title, what it is about, its actions */
export function PageHead({ title, sub, icon, children }: { title: ReactNode; sub?: ReactNode; icon?: IconName; children?: ReactNode }) {
  return <div className="page-head"><div><h2>{icon && <Icon name={icon} size={22} className="inline-icon" />} {title}</h2>{sub && <p className="muted">{sub}</p>}</div><span className="spacer" />{children}</div>;
}
