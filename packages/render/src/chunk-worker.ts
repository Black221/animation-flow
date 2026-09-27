// Worker-thread entry: renders one chunk and reports progress to the parent.
import { parentPort, workerData } from 'node:worker_threads';
import { renderChunk, type ChunkJob } from './chunk';

const job = workerData as ChunkJob;
const ctrl = new AbortController();
parentPort!.on('message', (m: { type: string }) => { if (m.type === 'abort') ctrl.abort(); });
let last = 0;
renderChunk(job, (done) => {
  const now = Date.now();
  if (now - last > 200 || done === job.to - job.from) { last = now; parentPort!.postMessage({ type: 'progress', done }); }
}, ctrl.signal)
  .then(() => parentPort!.postMessage({ type: 'done' }))
  .catch((e: Error) => parentPort!.postMessage({ type: 'error', name: e.name, message: e.message }));
