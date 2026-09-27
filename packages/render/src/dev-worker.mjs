// Development only (running from TypeScript sources): a worker thread does not inherit tsx from its parent, so this
// plain-JS entry loads the TypeScript worker through tsx's API. Production bundles use chunk-worker.js directly.
import { tsImport } from 'tsx/esm/api';

await tsImport('./chunk-worker.ts', import.meta.url);
