// The community: films people published, to watch and remix. The gallery (search, sort, tags), a publication's page
// (played in the page, liked, remixed into your workspace), an author's page. Readable without an account.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { Api, communityMedia, LICENSE_LABEL, type AuthorInfo, type Publication, type PublicationDetail } from '../api';
import { useSoundtrack } from '../audio/useSoundtrack';
import { Icon } from '../components/Icon';
import { Player } from '../components/Player';
import { Playback } from '../playback';
import { useUI } from '../components/ui';
import { HoverPlay, MotionPath, SkeletonGrid, useHover } from '../components/Motion';
import { useSession } from '../session';

const fmtDur = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')}` : `${Math.round(s)} s`);
const fmtDate = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
const thumb = (p: Publication) => `/api/community/${p.id}/thumbnail.png?v=${Date.parse(p.updatedAt)}`;

export function PubCard({ p }: { p: Publication }) {
  const hover = useHover();
  return (
    <li className="project-card pub-card" {...hover.bind}>
      <HoverPlay active={hover.on} still={thumb(p)} load={() => Api.publication(p.id).then((d) => d.project)} />
      <span className="dur">{fmtDur(p.duration)}</span>
      <div className="body">
        <Link to={`/c/${p.id}`} className="title">{p.title}</Link>
        <span className="meta">
          {p.author ? <Link to={`/u/${p.author.id}`} className="author">{p.author.name}</Link> : 'ancien membre'}
          {p.remixOf && <span className="badge accent" title={`remix de « ${p.remixOf.title} »`}><Icon name="remix" size={12} /> remix</span>}
        </span>
        <span className="stats">
          <span title="j'aime"><Icon name="heart" size={13} filled={p.liked} /> {p.likes}</span>
          <span title="remix"><Icon name="remix" size={13} /> {p.remixes}</span>
          <span title="vues"><Icon name="eye" size={13} /> {p.views}</span>
        </span>
      </div>
    </li>
  );
}

const SORTS = [['recent', 'Récents'], ['popular', 'Populaires'], ['remixed', 'Plus remixés']] as const;

export function Community() {
  const [params, setParams] = useSearchParams();
  const sort = params.get('sort') ?? 'recent', tag = params.get('tag') ?? '', q = params.get('q') ?? '';
  const [text, setText] = useState(q);
  const [items, setItems] = useState<Publication[] | null>(null);
  const [total, setTotal] = useState(0);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [error, setError] = useState('');
  const set = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };
  const load = useCallback(async (offset = 0) => {
    try {
      const r = await Api.community({ sort, tag, q, offset, limit: 24 });
      setItems((cur) => (offset && cur ? [...cur, ...r.items] : r.items)); setTotal(r.total); setTags(r.tags); setError('');
    } catch (e) { setError((e as Error).message); }
  }, [sort, tag, q]);
  useEffect(() => { void load(0); }, [load]);
  // search as you type, a moment after the last key
  useEffect(() => { const t = setTimeout(() => { if (text.trim() !== q) set('q', text.trim()); }, 300); return () => clearTimeout(t); }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page community">
      <section className="hero community-hero">
        <MotionPath className="hero-deco" />
        <h2>La <span className="grad">communauté</span></h2>
        <p className="lead">Des films faits par d'autres : regardez-les, aimez-les, et remixez-les pour en faire les vôtres. Tout y a été dessiné, composé et animé pour chaque histoire.</p>
        <div className="search-row">
          <label className="search"><Icon name="search" size={17} /><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Rechercher un film, un thème…" aria-label="rechercher" /></label>
          <div className="segmented" role="group" aria-label="tri">
            {SORTS.map(([k, label]) => <button key={k} type="button" aria-pressed={sort === k} onClick={() => set('sort', k === 'recent' ? '' : k)}>{label}</button>)}
          </div>
        </div>
        {tags.length > 0 && (
          <div className="chips" aria-label="étiquettes">
            {tags.map((t) => <button key={t.tag} className="chip" aria-pressed={tag === t.tag} onClick={() => set('tag', tag === t.tag ? '' : t.tag)}><Icon name="tag" size={12} /> {t.tag} <span className="muted">{t.count}</span></button>)}
          </div>
        )}
      </section>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="section-title"><h2>{tag ? `« ${tag} »` : q ? `Résultats pour « ${q} »` : 'Films publiés'}</h2>{items && <span className="badge">{total}</span>}</div>
      {items === null ? <SkeletonGrid n={8} /> : items.length === 0
        ? <p className="empty">{q || tag ? 'Rien ne correspond à cette recherche.' : 'Personne n’a encore publié de film. Ouvrez un projet et cliquez sur « Publier » : le vôtre sera le premier.'}</p>
        : <ul className="project-grid" aria-label="publications">{items.map((p) => <PubCard key={p.id} p={p} />)}</ul>}
      {items && items.length < total && <div className="load-more"><button onClick={() => void load(items.length)}>Voir plus</button></div>}
    </div>
  );
}

export function PublicationPage() {
  const { id = '' } = useParams();
  const { me, can } = useSession(), nav = useNavigate(), at = useLocation();
  const [p, setP] = useState<PublicationDetail | null>(null);
  const [error, setError] = useState('');
  const [style, setStyle] = useState<string | null>(null);
  const [sound, setSound] = useState(true);
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState(false);
  const ui = useUI();
  const pb = useMemo(() => new Playback(), []);
  const media = useMemo(() => communityMedia(id), [id]);
  const counted = useRef('');
  useEffect(() => {
    setP(null); setError('');
    Api.publication(id).then(setP).catch((e) => setError((e as Error).message));
    if (counted.current !== id) { counted.current = id; void Api.viewPublication(id).catch(() => undefined); }
  }, [id]);
  const EMPTY = useMemo(() => ({ schemaVersion: 1, title: '-', language: 'fr', fps: 24, width: 16, height: 16, style: 'flat', cast: {}, scenes: [], assets: {}, score: {}, sounds: {} }) as unknown as PublicationDetail['project'], []);
  const soundtrack = useSoundtrack(p?.project ?? EMPTY, sound && !!p, media.voices);

  if (error) return <div className="page"><p className="error">{error}</p><Link to="/c">← La communauté</Link></div>;
  if (!p) return <div className="page muted">Chargement…</div>;
  const signedIn = !!me?.user, canRemix = signedIn && can('editor');
  const like = async () => {
    if (!signedIn) return nav('/login', { state: { from: at.pathname } });
    const r = await Api.like(p.id, !p.liked).catch(() => null);
    if (r) setP({ ...p, liked: r.liked, likes: r.likes });
  };
  const remix = async () => {
    setBusy('remix');
    try { const r = await Api.remix(p.id); ui.toast(`« ${r.title} » est dans vos projets`); nav(`/p/${r.id}`); } catch (e) { ui.toast((e as Error).message, 'error'); setBusy(''); }
  };
  const withdraw = async () => {
    const ok = await ui.confirm({ title: `Retirer « ${p.title} » de la communauté ?`, message: "Il ne sera plus visible ni remixable. Le projet d'origine et les remix déjà faits ne sont pas touchés.", confirm: 'Retirer', danger: true });
    if (!ok) return;
    await Api.unpublish(p.id).then(() => { ui.toast('Publication retirée'); nav('/c'); }).catch((e) => ui.toast((e as Error).message, 'error'));
  };
  const share = async () => {
    try { await navigator.clipboard.writeText(location.href); setCopied(true); setTimeout(() => setCopied(false), 2000); ui.toast('Lien copié : partagez-le !'); }
    catch { ui.info({ title: 'Partager ce film', icon: 'link', size: 'sm', body: <><p className="muted small">Copiez ce lien :</p><input readOnly value={location.href} onFocus={(e) => e.target.select()} aria-label="lien" style={{ width: '100%' }} /></> }); }
  };
  const details = () => {
    const pr = p.project, drawings = Object.values(pr.assets ?? {});
    ui.info({ title: 'Informations', icon: 'info', size: 'md', body: (
      <dl className="details">
        <dt>Licence</dt><dd>{p.licenseLabel}</dd>
        <dt>Publié</dt><dd>{fmtDate(p.createdAt)}{p.updatedAt !== p.createdAt && <> · mis à jour le {fmtDate(p.updatedAt)}</>}</dd>
        <dt>Film</dt><dd>{fmtDur(p.duration)} · {pr.scenes.length} scène(s) · {pr.width} × {pr.height} · {pr.fps} images/s · style {pr.style}</dd>
        <dt>Dessins</dt><dd>{drawings.length ? `${drawings.filter((a) => a.kind === 'character').length} personnage(s), ${drawings.filter((a) => a.kind === 'prop').length} accessoire(s), ${drawings.filter((a) => a.kind === 'decor').length} décor(s)` : 'bibliothèque intégrée'}</dd>
        <dt>Son</dt><dd>{Object.keys(pr.score ?? {}).length} morceau(x) composé(s) · {Object.keys(pr.sounds ?? {}).length} bruitage(s) · {p.media.voices.length} réplique(s) enregistrée(s)</dd>
        <dt>Remixer</dt><dd>Une copie complète arrive dans votre espace (dessins, musique, voix) : modifiez-la librement, publiez-la à votre tour ; le lien vers ce film est gardé.</dd>
      </dl>) });
  };

  return (
    <div className="page publication">
      <Link to="/c" className="muted row back-link"><Icon name="back" size={16} /> La communauté</Link>
      <div className="pub-layout">
        <div className="pub-main">
          <Player project={p.project} pb={pb} style={style ?? p.project.style} onStyle={setStyle} imageLinks={media.images}
            audio={soundtrack.buffer} sound={sound} onSound={setSound} soundInfo={!sound ? '' : soundtrack.mixing ? 'mixage du son…' : soundtrack.buffer ? 'son prêt' : ''} />
        </div>
        <aside className="pub-side card">
          <h2>{p.title}</h2>
          <div className="pub-author">
            {p.author ? <Link to={`/u/${p.author.id}`} className="row"><span className="avatar" aria-hidden>{initials(p.author.name)}</span><span><strong>{p.author.name}</strong><span className="muted small">{fmtDate(p.createdAt)}</span></span></Link>
              : <span className="muted">ancien membre</span>}
          </div>
          {p.remixOf && <p className="pub-origin small"><Icon name="remix" size={14} /> Remix de <Link to={`/c/${p.remixOf.id}`}>« {p.remixOf.title} »</Link>{p.remixOf.author && <> par {p.remixOf.authorId ? <Link to={`/u/${p.remixOf.authorId}`}>{p.remixOf.author}</Link> : p.remixOf.author}</>}</p>}
          {p.description && <p className="pub-desc">{p.description}</p>}
          {p.tags.length > 0 && <div className="chips">{p.tags.map((t) => <Link key={t} className="chip" to={`/c?tag=${encodeURIComponent(t)}`}><Icon name="tag" size={12} /> {t}</Link>)}</div>}
          <div className="pub-stats">
            <span><Icon name="clock" size={15} /> {fmtDur(p.duration)}</span>
            <span><Icon name="eye" size={15} /> {p.views} vue{p.views > 1 ? 's' : ''}</span>
            <span><Icon name="remix" size={15} /> {p.remixes} remix</span>
          </div>
          <div className="pub-actions">
            <button className="cta" onClick={() => void remix()} disabled={!canRemix || !!busy} title={canRemix ? 'une copie dans votre espace, à modifier librement' : ''}><Icon name="remix" /> {busy === 'remix' ? 'Copie…' : 'Remixer'}</button>
            <button className={`like${p.liked ? ' on' : ''}`} onClick={() => void like()} aria-pressed={p.liked} aria-label="j'aime"><Icon name="heart" filled={p.liked} /> {p.likes}</button>
            <button className="icon" onClick={() => void share()} aria-label="copier le lien" title={copied ? 'lien copié' : 'copier le lien'}><Icon name={copied ? 'check' : 'link'} /></button>
            <button className="icon" onClick={details} aria-label="informations" title="informations"><Icon name="info" /></button>
          </div>
          {!signedIn && <p className="small muted"><Link to="/login" state={{ from: at.pathname }}>Connectez-vous</Link>{me?.signup === 'open' || me?.setup ? <> ou <Link to="/signup">créez un compte</Link></> : null} pour remixer ce film et l'aimer.</p>}
          {signedIn && !can('editor') && <p className="small muted">Votre rôle dans cet espace (lecteur) ne permet pas d'y créer de projet : changez d'espace pour remixer.</p>}
          <p className="small muted license"><Icon name="globe" size={13} /> {LICENSE_LABEL[p.license]}</p>
          {p.canManage && <button className="ghost danger-ghost small" onClick={() => void withdraw()}><Icon name="trash" size={15} /> Retirer de la communauté</button>}
        </aside>
      </div>
      <div className="section-title"><h2>Remix</h2><span className="badge">{p.remixes}</span></div>
      {p.remixList.length ? <ul className="project-grid">{p.remixList.map((r) => <PubCard key={r.id} p={r} />)}</ul>
        : <p className="empty">Personne n'a encore remixé ce film. {canRemix ? 'Soyez le premier !' : ''}</p>}
    </div>
  );
}

export function AuthorPage() {
  const { id = '' } = useParams();
  const [a, setA] = useState<AuthorInfo | null>(null);
  const [items, setItems] = useState<Publication[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    Api.author(id).then(setA).catch((e) => setError((e as Error).message));
    Api.community({ author: id, limit: 60 }).then((r) => setItems(r.items)).catch(() => setItems([]));
  }, [id]);
  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!a) return <div className="page muted">Chargement…</div>;
  return (
    <div className="page">
      <Link to="/c" className="muted row back-link"><Icon name="back" size={16} /> La communauté</Link>
      <section className="author-head card">
        <span className="avatar big" aria-hidden>{initials(a.name)}</span>
        <div><h2>{a.name}</h2><p className="muted small">membre depuis {fmtDate(a.since)}</p></div>
        <span className="spacer" />
        <div className="pub-stats">
          <span><Icon name="film" size={15} /> {a.publications} film{a.publications > 1 ? 's' : ''}</span>
          <span><Icon name="heart" size={15} /> {a.likes}</span>
          <span><Icon name="remix" size={15} /> {a.remixes} remix</span>
        </div>
      </section>
      <div className="section-title"><h2>Films publiés</h2></div>
      {items === null ? <SkeletonGrid n={4} /> : items.length ? <ul className="project-grid">{items.map((p) => <PubCard key={p.id} p={p} />)}</ul> : <p className="empty">Aucun film publié pour l'instant.</p>}
    </div>
  );
}
