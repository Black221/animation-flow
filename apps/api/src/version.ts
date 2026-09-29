// What this server runs: the version (from package.json, bundled in at build time) and the commit. The image build
// passes the commit (docker build --build-arg APP_COMMIT=…) since it has no .git; in development it is read from git.
import { execFileSync } from 'node:child_process';
import pkg from '../package.json';

export function commitOf(env: NodeJS.ProcessEnv): string | null {
  if (env.APP_COMMIT) return env.APP_COMMIT.slice(0, 12);
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).toString().trim() || null;
  } catch { return null; }
}

export const VERSION: { version: string; commit: string | null } = { version: pkg.version, commit: commitOf(process.env) };
