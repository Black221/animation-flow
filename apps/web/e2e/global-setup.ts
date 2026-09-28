// Before the tests: the back office's first manager (with the setup secret), the app's owner, and the owner's
// workspace on Pro — the tests share it and make more projects than the free plan allows.
import { request } from '@playwright/test';
import { ADMIN, ADMIN_SETUP_TOKEN } from '../playwright.config';
import { MANAGER, OWNER } from './auth';

export default async function globalSetup() {
  const H = { 'x-requested-with': 'animation-flow' }, A = { 'x-requested-with': 'animation-flow-admin' };
  const app = await request.newContext({ baseURL: 'http://127.0.0.1:4173', extraHTTPHeaders: H });
  if ((await app.post('/api/auth/signup', { data: OWNER })).status() !== 201) await app.post('/api/auth/login', { data: { email: OWNER.email, password: OWNER.password } });
  const ws = (await (await app.get('/api/auth/me')).json()).workspaces[0].id as string;
  const bo = await request.newContext({ baseURL: ADMIN, extraHTTPHeaders: A });
  const setup = await bo.post('/api/setup', { data: { token: ADMIN_SETUP_TOKEN, ...MANAGER } });
  if (setup.status() !== 201) await bo.post('/api/auth/login', { data: { email: MANAGER.email, password: MANAGER.password } });
  const r = await bo.patch(`/api/admin/workspaces/${ws}`, { data: { plan: 'pro' } });
  if (!r.ok()) throw new Error(`global setup: ${r.status()} ${await r.text()}`);
  await app.dispose(); await bo.dispose();
}
