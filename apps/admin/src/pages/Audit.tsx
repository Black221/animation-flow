// The audit log: every action taken in the back office (sign-ins included), who, what, when, from where; searchable.
import { Icon, useUI } from '@af/ui';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Api, dateTime, type AuditEntry, type Page } from '../api';
import { PageHead } from '../App';
import { More } from '../parts';
import { Bounce } from '../ui-bits';

const ICON: Record<string, Parameters<typeof Icon>[0]['name']> = { 'sign-in': 'key', suspend: 'ban', restore: 'check', 'grant-admin': 'shield', 'revoke-admin': 'shield', signout: 'logout', 'set-plan': 'card', 'set-limits': 'sliders', hide: 'eye', unhide: 'eye', remove: 'trash' };
const link = (e: AuditEntry) => (e.target.id && e.target.type === 'user' ? `/users/${e.target.id}` : e.target.id && e.target.type === 'workspace' ? `/workspaces/${e.target.id}` : null);

export function Audit() {
  const ui = useUI();
  const [q, setQ] = useState(''), [list, setList] = useState<Page<AuditEntry> | null>(null);
  const load = (offset = 0) => Api.audit({ q, offset }).then((r) => setList((l) => (offset && l ? { total: r.total, items: [...l.items, ...r.items] } : r))).catch((e) => ui.toast((e as Error).message, 'error'));
  useEffect(() => { const t = setTimeout(() => void load(), 200); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <PageHead title="Journal" sub="Tout ce qui se fait dans le back-office, connexions comprises : qui, quoi, quand, d'où. Rien ne s'y efface." icon="shield" />
      <div className="search-row"><label className="search"><Icon name="search" size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Un nom, une action, un plan…" aria-label="chercher dans le journal" /></label></div>
      {!list ? <Bounce /> : list.items.length === 0 ? <div className="empty"><p>Rien dans le journal{q ? ' pour cette recherche' : ''}.</p></div> : (
        <ol className="bo-audit" aria-label="journal">{list.items.map((e) => {
          const to = link(e);
          return (
            <li key={e.id}>
              <span className="kf" aria-hidden><Icon name={ICON[e.action] ?? (e.action.startsWith('report') ? 'flag' : 'info')} size={13} /></span>
              <span className="what"><strong>{e.admin.name}</strong> {to ? <Link to={to}>{e.summary}</Link> : e.summary}</span>
              <span className="muted small when">{dateTime(e.at)}{e.ip ? ` · ${e.ip}` : ''}</span>
            </li>
          );
        })}</ol>
      )}
      {list && <More shown={list.items.length} total={list.total} onMore={() => void load(list.items.length)} />}
    </>
  );
}
