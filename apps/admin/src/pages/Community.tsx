// The community: the reports to settle (dismiss, hide, remove: every open report on the film with it), and every
// published film, hidden ones too (hide, bring back, remove).
import { Icon, useUI } from '@af/ui';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ago, Api, REPORT_REASON, type Film, type Page, type Report } from '../api';
import { PageHead, useAdmin } from '../App';
import { More } from '../parts';
import { Bounce } from '../ui-bits';

const secs = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** a film's title, linked to its page in the app when the app's address is known */
function FilmLink({ id, title }: { id: string; title: string }) {
  const { appUrl } = useAdmin();
  return appUrl ? <a href={`${appUrl}/c/${id}`} target="_blank" rel="noopener"><strong>{title}</strong> <Icon name="link" size={12} /></a> : <strong>{title}</strong>;
}

export function Moderation() {
  const ui = useUI(), { refreshCounts } = useAdmin();
  const [status, setStatus] = useState<'open' | 'resolved'>('open');
  const [list, setList] = useState<Report[] | null>(null);
  const load = () => Api.reports(status).then(setList).catch((e) => ui.toast((e as Error).message, 'error'));
  useEffect(() => { setList(null); void load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  const settle = async (r: Report, action: 'dismiss' | 'hide' | 'remove') => {
    const ask = { dismiss: { title: 'Classer sans suite ?', message: `« ${r.publication.title} » reste dans la communauté.`, confirm: 'Classer' },
      hide: { title: `Masquer « ${r.publication.title} » ?`, message: 'Il sort de la communauté ; son auteur le voit encore et vous pourrez le remettre.', confirm: 'Masquer', danger: true },
      remove: { title: `Retirer « ${r.publication.title} » pour de bon ?`, message: 'La publication et ses médias sont supprimés. Le projet de son auteur, lui, reste.', confirm: 'Retirer', danger: true, typeToConfirm: r.publication.title } }[action];
    if (!(await ui.confirm(ask))) return;
    try { await Api.settle(r.id, action); ui.toast({ dismiss: 'Classé sans suite', hide: 'Film masqué', remove: 'Film retiré' }[action]); void load(); refreshCounts(); } catch (e) { ui.toast((e as Error).message, 'error'); }
  };
  return (
    <>
      <PageHead title="Modération" sub="Les films signalés par la communauté. Chaque décision est inscrite au journal." icon="flag" />
      <div className="segmented" role="group" aria-label="signalements">{([['open', 'À traiter'], ['resolved', 'Traités']] as const).map(([k, l]) => <button key={k} aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>)}</div>
      {!list ? <Bounce /> : list.length === 0 ? <div className="empty"><p>{status === 'open' ? 'Aucun signalement à traiter.' : 'Aucun signalement traité.'}</p></div> : (
        <ul className="report-list" aria-label="signalements">{list.map((r) => (
          <li key={r.id} className="card">
            <div className="row wrap">
              <FilmLink id={r.publication.id} title={r.publication.title} />
              <span className="muted small">de {r.publication.author?.name ?? 'ancien membre'}</span>
              {r.publication.hidden && <span className="badge">masqué</span>}
              <span className="spacer" />
              <span className="badge error"><Icon name="flag" size={12} /> {REPORT_REASON[r.reason]}</span>
            </div>
            {r.message && <blockquote>{r.message}</blockquote>}
            <span className="muted small">Signalé par {r.reporter ?? 'un ancien membre'} {ago(r.createdAt)}{r.publication.openReports > 1 ? ` · ${r.publication.openReports} signalements sur ce film` : ''}{r.resolvedAt ? ` · ${{ dismissed: 'classé', hidden: 'masqué', removed: 'retiré' }[r.status] ?? r.status} par ${r.resolvedBy ?? '?'} ${ago(r.resolvedAt)}` : ''}</span>
            {status === 'open' && <div className="row wrap">
              <button className="small" onClick={() => void settle(r, 'dismiss')}><Icon name="check" size={14} /> Rien à redire</button>
              <button className="small" onClick={() => void settle(r, 'hide')}><Icon name="eye" size={14} /> Masquer</button>
              <button className="small danger-ghost" onClick={() => void settle(r, 'remove')}><Icon name="trash" size={14} /> Retirer</button>
            </div>}
          </li>
        ))}</ul>
      )}
    </>
  );
}

export function Films() {
  const ui = useUI(), { refreshCounts } = useAdmin();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '', status = params.get('status') ?? 'all';
  const [list, setList] = useState<Page<Film> | null>(null);
  const load = (offset = 0) => Api.films({ q, status, offset }).then((r) => setList((l) => (offset && l ? { total: r.total, items: [...l.items, ...r.items] } : r))).catch((e) => ui.toast((e as Error).message, 'error'));
  useEffect(() => { const t = setTimeout(() => void load(), 200); return () => clearTimeout(t); }, [q, status]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v && v !== 'all') p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  const hide = async (f: Film) => {
    if (!(await ui.confirm(f.hidden ? { title: `Remettre « ${f.title} » dans la communauté ?`, confirm: 'Remettre' } : { title: `Masquer « ${f.title} » ?`, message: 'Il sort de la communauté ; son auteur le voit encore.', confirm: 'Masquer', danger: true }))) return;
    try { await Api.hideFilm(f.id, !f.hidden); ui.toast(f.hidden ? 'De retour dans la communauté' : 'Film masqué'); void load(); } catch (e) { ui.toast((e as Error).message, 'error'); }
  };
  const remove = async (f: Film) => {
    if (!(await ui.confirm({ title: `Retirer « ${f.title} » pour de bon ?`, message: 'La publication et ses médias sont supprimés ; le projet de son auteur reste.', confirm: 'Retirer', danger: true, typeToConfirm: f.title }))) return;
    try { await Api.removeFilm(f.id); ui.toast('Film retiré'); void load(); refreshCounts(); } catch (e) { ui.toast((e as Error).message, 'error'); }
  };
  return (
    <>
      <PageHead title="Films publiés" sub={list ? `${list.total} film${list.total > 1 ? 's' : ''}` : 'La communauté'} icon="film" />
      <div className="search-row">
        <label className="search"><Icon name="search" size={16} /><input value={q} onChange={(e) => set('q', e.target.value)} placeholder="Titre ou auteur…" aria-label="chercher un film" /></label>
        <div className="segmented" role="group" aria-label="état">{([['all', 'Tous'], ['visible', 'Visibles'], ['hidden', 'Masqués'], ['reported', 'Signalés']] as const).map(([k, l]) => <button key={k} aria-pressed={status === k} onClick={() => set('status', k)}>{l}</button>)}</div>
      </div>
      {!list ? <Bounce /> : list.items.length === 0 ? <div className="empty"><p>Aucun film ne correspond.</p></div> : (
        <table className="admin-table" aria-label="films">
          <thead><tr><th>Film</th><th className="hide-phone">Audience</th><th className="hide-tablet">Publié</th><th><span className="sr-only">actions</span></th></tr></thead>
          <tbody>{list.items.map((f) => (
            <tr key={f.id} className={f.hidden ? 'suspended' : ''}>
              <td><span className="who-line"><FilmLink id={f.id} title={f.title} />{f.hidden && <span className="badge">masqué</span>}{f.openReports > 0 && <span className="badge error"><Icon name="flag" size={11} /> {f.openReports}</span>}</span><span className="muted small">{f.author?.name ?? 'ancien membre'} · {secs(f.duration)}</span></td>
              <td className="hide-phone muted small"><Icon name="eye" size={12} /> {f.views} · <Icon name="heart" size={12} /> {f.likes} · <Icon name="remix" size={12} /> {f.remixes}</td>
              <td className="hide-tablet muted small">{ago(f.createdAt)}</td>
              <td className="actions"><span className="row">
                <button className="small" onClick={() => void hide(f)}><Icon name="eye" size={14} /> {f.hidden ? 'Remettre' : 'Masquer'}</button>
                <button className="small danger-ghost" onClick={() => void remove(f)} aria-label={`retirer ${f.title}`}><Icon name="trash" size={14} /></button>
              </span></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {list && <More shown={list.items.length} total={list.total} onMore={() => void load(list.items.length)} />}
    </>
  );
}
