// The back office: the platform manager's tool. Its own accounts (managers, not the platform's users): the first one is
// created with the setup secret, the next ones by invitation; then a control room — a sidebar of sections.
import { Dialog, Icon, type IconName, Menu, setTheme, UIProvider, useTheme, useUI } from '@af/ui';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { Api, onSignedOut, type Admin } from './api';
import { Audit } from './pages/Audit';
import { Dashboard } from './pages/Dashboard';
import { Films, Moderation } from './pages/Community';
import { Plans, Subscriptions } from './pages/Billing';
import { Staff } from './pages/Staff';
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
  { label: 'Sécurité', items: [['/staff', 'shield', 'Gérants'], ['/audit', 'key', 'Journal']] },
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

function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ui = useUI();
  const [current, setCurrent] = useState(''), [next, setNext] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setCurrent(''); setNext(''); } }, [open]);
  const save = async () => {
    setBusy(true);
    try { await Api.password(current, next); ui.toast('Mot de passe changé ; vos autres sessions sont fermées'); onClose(); } catch (e) { ui.toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Changer de mot de passe" icon="key" size="sm"
      footer={<><button className="ghost" onClick={onClose}>Annuler</button><button className="primary" onClick={() => void save()} disabled={busy || !current || next.length < 10}>Changer</button></>}>
      <label className="field">Mot de passe actuel<input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
      <label className="field">Nouveau mot de passe <span className="muted small">(10 caractères au moins)</span><input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></label>
    </Dialog>
  );
}

function Layout() {
  const { admin, signOut } = useAdmin(), [drawer, setDrawer] = useState(false), loc = useLocation(), [pw, setPw] = useState(false);
  const [running, setRunning] = useState<{ version: string; commit: string | null } | null>(null);
  useEffect(() => setDrawer(false), [loc.pathname]);
  useEffect(() => { Api.health().then(setRunning, () => undefined); }, []);
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
              <div className="who"><strong>{admin?.name}</strong><span className="muted small">{admin?.email} · gérant</span><span className="muted small">Session du back-office : 12 h au plus</span></div>
              <button role="menuitem" onClick={() => setPw(true)}><Icon name="key" /> Changer de mot de passe</button>
              <button role="menuitem" onClick={() => void signOut()}><Icon name="logout" /> Se déconnecter</button>
            </>}
          </Menu>
          <PasswordDialog open={pw} onClose={() => setPw(false)} />
        </header>
        <main className="bo-page"><Outlet /></main>
        {running && <footer className="bo-foot">animation-flow {running.version}{running.commit && <> · <code>{running.commit}</code></>}</footer>}
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
        <p className="muted small">Réservé aux gérants de la plateforme, avec leur compte du back-office (pas celui de l'application). Chaque action est inscrite au journal.</p>
        <label className="field">E-mail<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
        <label className="field">Mot de passe<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <div className="alert error" role="alert"><Icon name="alert" size={16} /><span>{error}</span></div>}
        <button className="primary" disabled={busy || !email || !password}>{busy ? 'Connexion…' : 'Se connecter'}</button>
      </form>
    </div>
  );
}

/** the first manager: the setup secret (in the server's file, or its configuration), a name, an e-mail, a password */
function Setup({ onIn }: { onIn: (a: Admin) => void }) {
  const [params] = useSearchParams();
  const [token, setToken] = useState(params.get('token') ?? ''), [name, setName] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const submit = async () => { setBusy(true); setError(''); try { onIn((await Api.setup({ token: token.trim(), name, email: email.trim(), password })).user); } catch (e) { setError((e as Error).message); setBusy(false); } };
  return (
    <div className="bo-login">
      <form className="card" aria-label="création du back-office" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <span className="bo-brand"><span className="logo" aria-hidden><Icon name="shield" size={15} /></span><span>animation-flow<small>Back-office</small></span></span>
        <h1>Premier gérant</h1>
        <p className="muted small">Ce back-office n'a pas encore de gérant. Le code de création se trouve sur le serveur, dans le fichier <code>admin-setup-token</code> du dossier de données (ou dans <code>ADMIN_SETUP_TOKEN</code>). Ce compte est celui du back-office, pas un compte de l'application.</p>
        <label className="field">Code de création<input value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" required /></label>
        <label className="field">Nom<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required /></label>
        <label className="field">E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
        <label className="field">Mot de passe <span className="muted small">(10 caractères au moins)</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required /></label>
        {error && <div className="alert error" role="alert"><Icon name="alert" size={16} /><span>{error}</span></div>}
        <button className="primary" disabled={busy || !token || !name || !email || password.length < 10}>Créer le back-office</button>
      </form>
    </div>
  );
}

/** a manager invited by another: the e-mail is the invitation's, the name and password theirs */
function Join({ onIn }: { onIn: (a: Admin) => void }) {
  const { token = '' } = useParams();
  const [inv, setInv] = useState<{ email: string } | null>(null), [error, setError] = useState(''), [name, setName] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { Api.invitation(token).then(setInv).catch((e) => setError((e as Error).message)); }, [token]);
  const submit = async () => { setBusy(true); setError(''); try { onIn((await Api.join(token, { name, password })).user); } catch (e) { setError((e as Error).message); setBusy(false); } };
  return (
    <div className="bo-login">
      <form className="card" aria-label="rejoindre les gérants" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <span className="bo-brand"><span className="logo" aria-hidden><Icon name="shield" size={15} /></span><span>animation-flow<small>Back-office</small></span></span>
        <h1>Rejoindre les gérants</h1>
        {inv ? <p className="muted small">Votre compte du back-office : <strong>{inv.email}</strong>. Choisissez votre nom et votre mot de passe.</p> : !error && <p className="muted small">Vérification de l'invitation…</p>}
        {inv && <>
          <label className="field">Nom<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required autoFocus /></label>
          <label className="field">Mot de passe <span className="muted small">(10 caractères au moins)</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required /></label>
        </>}
        {error && <div className="alert error" role="alert"><Icon name="alert" size={16} /><span>{error}</span></div>}
        {inv && <button className="primary" disabled={busy || !name || password.length < 10}>Créer mon compte</button>}
        {!inv && error && <Link to="/">Aller à la connexion</Link>}
      </form>
    </div>
  );
}

function Shell() {
  const [state, setState] = useState<{ admin: Admin | null; appUrl: string | null; setup: boolean; loading: boolean }>({ admin: null, appUrl: null, setup: false, loading: true });
  const [counts, setCounts] = useState({ reports: 0, pastDue: 0 });
  const nav = useNavigate(), ui = useUI();
  const load = () => Api.me().then((m) => setState({ admin: m.user, appUrl: m.appUrl ?? null, setup: !!m.setup, loading: false })).catch(() => setState((s) => ({ ...s, loading: false })));
  const at = useLocation().pathname;
  useEffect(() => { void load(); }, []);
  useEffect(() => onSignedOut(() => { setState((s) => ({ ...s, admin: null })); ui.toast('Session terminée : reconnectez-vous', 'info'); }), [ui]);
  const refreshCounts = () => { Api.overview().then((o) => setCounts({ reports: o.openReports, pastDue: o.pastDue })).catch(() => undefined); };
  useEffect(() => { if (state.admin) refreshCounts(); }, [state.admin]);
  if (state.loading) return null;
  const signedIn = (a: Admin) => { setState((s) => ({ ...s, admin: a, setup: false })); void load(); nav('/'); };
  if (!state.admin) {
    if (at.startsWith('/join/')) return <Routes><Route path="/join/:token" element={<Join onIn={signedIn} />} /></Routes>;
    return state.setup ? <Setup onIn={signedIn} /> : <Login onIn={signedIn} />;
  }
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
          <Route path="/staff" element={<Staff />} />
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
