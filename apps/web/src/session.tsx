// Who is signed in, the workspace in use and the role there. Pages read it to show what the role allows (the API
// enforces it anyway).
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Api, getWorkspace, onUnauthorized, RANK, setWorkspace, type Me, type Role } from './api';

interface Session {
  me: Me | null;
  loading: boolean;
  workspace: Me['workspaces'][number] | null;
  role: Role | null;
  can: (r: Role) => boolean;
  refresh: () => Promise<Me | null>;
  switchTo: (id: string) => void;
  signOut: () => Promise<void>;
  /** changes when the workspace changes: pages keyed on it reload their data */
  epoch: number;
}
const Ctx = createContext<Session | null>(null);
export const useSession = () => useContext(Ctx)!;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [epoch, setEpoch] = useState(0);
  const refresh = useCallback(async () => {
    try {
      const m = await Api.me();
      // keep the chosen workspace if still a member, else the first one
      if (m.user && !m.workspaces.some((w) => w.id === getWorkspace())) setWorkspace(m.workspaces[0]?.id ?? '');
      setMe(m); return m;
    } catch { setMe(null); return null; } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => onUnauthorized(() => { void refresh(); }), [refresh]);
  const workspace = me?.user ? me.workspaces.find((w) => w.id === getWorkspace()) ?? me.workspaces[0] ?? null : null;
  const role = workspace?.role ?? null;
  const value: Session = {
    me, loading, workspace, role, epoch, refresh,
    can: (r) => !!role && RANK[role] >= RANK[r],
    switchTo: (id) => { setWorkspace(id); setEpoch((e) => e + 1); },
    signOut: async () => { await Api.logout().catch(() => undefined); setWorkspace(''); await refresh(); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
