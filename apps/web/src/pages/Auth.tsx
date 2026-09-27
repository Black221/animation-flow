// Signing in, signing up (the very first account, or with an invitation), joining through an invitation link, and
// (when the server sends e-mail) resetting a forgotten password.
import { useEffect, useState, type FormEvent, type InputHTMLAttributes } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Api, ROLE_LABEL, setWorkspace, type Role } from '../api';
import { useSession } from '../session';

function Field({ label, ...p }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <label>{label}<input {...p} /></label>;
}

export function Login() {
  const { refresh, me } = useSession(), nav = useNavigate();
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [error, setError] = useState('');
  const submit = async (e: FormEvent) => { e.preventDefault(); setError(''); try { await Api.login(email, password); await refresh(); nav('/'); } catch (err) { setError((err as Error).message); } };
  return (
    <div className="auth">
      <form className="card form" onSubmit={submit} aria-label="connexion">
        <h2>Connexion</h2>
        <Field label="E-mail" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        <Field label="Mot de passe" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="error small" role="alert">{error}</p>}
        <button className="primary" type="submit">Se connecter</button>
        {me?.mail && <p className="small"><Link to="/forgot">Mot de passe oublié ?</Link></p>}
        {(me?.setup || me?.signup === 'open') && <p className="small"><Link to="/signup">Créer un compte</Link></p>}
        {me?.signup === 'invite' && !me.setup && <p className="muted small">Pas de compte ? Demandez un lien d'invitation à un administrateur de votre équipe.</p>}
      </form>
    </div>
  );
}

function SignupForm({ invitation, email: fixedEmail, onDone }: { invitation?: string; email?: string | null; onDone: () => void }) {
  const [name, setName] = useState(''), [email, setEmail] = useState(fixedEmail ?? ''), [password, setPassword] = useState(''), [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('');
    try { const m = await Api.signup({ name, email, password, ...(invitation ? { invitation } : {}) }); setWorkspace(m.workspaces[0]?.id ?? ''); onDone(); }
    catch (err) { setError((err as Error).message); }
  };
  return (
    <form className="form" onSubmit={submit} aria-label="inscription">
      <Field label="Nom" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
      <Field label="E-mail" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required readOnly={!!fixedEmail} />
      <Field label="Mot de passe (10 caractères au moins)" type="password" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} required />
      {error && <p className="error small" role="alert">{error}</p>}
      <button className="primary" type="submit">Créer le compte</button>
    </form>
  );
}

export function Signup() {
  const { me, refresh } = useSession(), nav = useNavigate();
  return (
    <div className="auth">
      <div className="card form">
        <h2>{me?.setup ? 'Premier compte' : 'Créer un compte'}</h2>
        {me?.setup && <p className="muted small">Ce compte sera propriétaire de l'espace de travail et de tout ce qui y existe déjà. Il pourra ensuite inviter l'équipe.</p>}
        {me && !me.setup && me.signup === 'invite' ? <p className="muted">L'inscription se fait sur invitation. Demandez un lien à un administrateur.</p>
          : <SignupForm onDone={() => { void refresh().then(() => nav('/')); }} />}
        <p className="small"><Link to="/login">J'ai déjà un compte</Link></p>
      </div>
    </div>
  );
}

function InlineLogin({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [error, setError] = useState('');
  const submit = async (e: FormEvent) => { e.preventDefault(); setError(''); try { await Api.login(email, password); onDone(); } catch (err) { setError((err as Error).message); } };
  return (
    <form className="form" onSubmit={submit} aria-label="connexion">
      <Field label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <Field label="Mot de passe" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      {error && <p className="error small" role="alert">{error}</p>}
      <button className="primary" type="submit">Se connecter et rejoindre</button>
    </form>
  );
}

export function Invite() {
  const { token = '' } = useParams(), { me, refresh, switchTo } = useSession(), nav = useNavigate();
  const [inv, setInv] = useState<{ workspace: string; role: Role; email: string | null } | null>(null), [error, setError] = useState(''), [mode, setMode] = useState<'signup' | 'login'>('signup');
  useEffect(() => { Api.invitation(token).then(setInv).catch((e) => setError((e as Error).message)); }, [token]);
  const accept = async () => { try { const r = await Api.acceptInvitation(token); await refresh(); switchTo(r.workspace.id); nav('/'); } catch (e) { setError((e as Error).message); } };
  return (
    <div className="auth">
      <div className="card form" aria-label="invitation">
        <h2>Invitation</h2>
        {error && <p className="error" role="alert">{error}</p>}
        {inv && <p>Vous êtes invité·e à rejoindre <strong>{inv.workspace}</strong> comme <strong>{ROLE_LABEL[inv.role]}</strong>.</p>}
        {inv && me?.user && <><p className="muted small">Connecté·e en tant que {me.user.email}.</p><button className="primary" onClick={() => void accept()}>Rejoindre l'espace</button></>}
        {inv && !me?.user && mode === 'signup' && <><SignupForm invitation={token} email={inv.email} onDone={() => { void refresh().then(() => nav('/')); }} /><button className="ghost small" onClick={() => setMode('login')}>J'ai déjà un compte</button></>}
        {inv && !me?.user && mode === 'login' && <InlineLogin onDone={() => void accept()} />}
      </div>
    </div>
  );
}

export function Forgot() {
  const [email, setEmail] = useState(''), [sent, setSent] = useState(false), [error, setError] = useState('');
  const submit = async (e: FormEvent) => { e.preventDefault(); setError(''); try { await Api.forgot(email); setSent(true); } catch (err) { setError((err as Error).message); } };
  return (
    <div className="auth">
      <form className="card form" onSubmit={submit} aria-label="mot de passe oublié">
        <h2>Mot de passe oublié</h2>
        {sent ? <p role="status" data-testid="forgot-sent">Si un compte existe pour {email}, un lien pour choisir un nouveau mot de passe vient d'y être envoyé. Il est valable une heure.</p> : <>
          <p className="muted small">Indiquez l'adresse de votre compte : vous recevrez un lien pour choisir un nouveau mot de passe.</p>
          <Field label="E-mail" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          {error && <p className="error small" role="alert">{error}</p>}
          <button className="primary" type="submit">Envoyer le lien</button>
        </>}
        <p className="small"><Link to="/login">Retour à la connexion</Link></p>
      </form>
    </div>
  );
}

export function Reset() {
  const { token = '' } = useParams(), { refresh } = useSession(), nav = useNavigate();
  const [email, setEmail] = useState<string | null>(null), [password, setPassword] = useState(''), [again, setAgain] = useState(''), [error, setError] = useState('');
  useEffect(() => { Api.resetInfo(token).then((r) => setEmail(r.email)).catch((e) => setError((e as Error).message)); }, [token]);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('');
    if (password !== again) return setError('les deux mots de passe diffèrent');
    try { const m = await Api.resetPassword(token, password); setWorkspace(m.workspaces[0]?.id ?? ''); await refresh(); nav('/'); } catch (err) { setError((err as Error).message); }
  };
  return (
    <div className="auth">
      <form className="card form" onSubmit={submit} aria-label="nouveau mot de passe">
        <h2>Nouveau mot de passe</h2>
        {email && <p className="muted small">Compte : {email}. Vous serez déconnecté·e de tous vos appareils.</p>}
        {email && <>
          <Field label="Nouveau mot de passe (10 caractères au moins)" type="password" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
          <Field label="Encore une fois" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
        </>}
        {error && <p className="error small" role="alert">{error}</p>}
        {email ? <button className="primary" type="submit">Changer le mot de passe</button> : <p className="small"><Link to="/forgot">Demander un nouveau lien</Link></p>}
      </form>
    </div>
  );
}
