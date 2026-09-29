// The tests' `test` and `expect`: Playwright's, plus a guard that runs in every test. Any page the test opens (in its
// own context or in one it makes) that breaks the Content Security Policy fails the test: the editor, rendering, the
// AI, the community, video playback and the back office must all work under it.
import { test as base, expect, type Browser, type BrowserContext } from '@playwright/test';

export { expect };

const REPORT = () => {
  // Chromium also logs its own message; this one names the directive and what was blocked, in every page
  document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI || '(inline)'} in ${e.sourceFile || location.href}`));
};

export const test = base.extend<{ cspGuard: void }>({
  cspGuard: [async ({ context, browser }, use) => {
    const violations: string[] = [];
    const watch = async (ctx: BrowserContext) => {
      await ctx.addInitScript(REPORT);
      ctx.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|CSP violation/.test(m.text())) violations.push(m.text()); });
    };
    await watch(context);
    // contexts and pages the test makes itself (a second person, another browser) are watched too
    const b = browser as Browser & Record<'newContext' | 'newPage', unknown>, { newContext, newPage } = browser;
    b.newContext = async (...a: Parameters<Browser['newContext']>) => { const c = await newContext.apply(browser, a); await watch(c); return c; };
    b.newPage = async (...a: Parameters<Browser['newPage']>) => { const c = await b.newContext(...(a as Parameters<Browser['newContext']>)) as BrowserContext; const p = await c.newPage(); p.on('close', () => void c.close()); return p; };
    try { await use(); } finally { b.newContext = newContext; b.newPage = newPage; }
    expect(violations, 'Content Security Policy violations').toEqual([]);
  }, { auto: true }],
});
