import { AppError } from './errors.js';
import { LocalObjects } from './objects.js';
import { Store } from './store.js';
import { MaterialQueue } from './material-queue.js';
import { parseMaterial } from './material-parser.js';

export class IngestionWorker {
  private stopping = false;
  readonly queue: MaterialQueue;
  constructor(store: Store, private objects: LocalObjects, private parse = parseMaterial) { this.queue = new MaterialQueue(store); }
  async tick(): Promise<boolean> {
    const claim = await this.queue.claim();
    if (!claim) return false;
    let bytes: Buffer;
    try { bytes = await this.objects.readBinary(claim.material.objectKey, claim.material.sizeBytes); }
    catch (error) {
      await this.queue.finish(claim, { errorCode: error instanceof AppError ? error.code : 'SOURCE_READ_FAILED' });
      return true;
    }
    try { await this.queue.finish(claim, { output: await this.parse(claim.material, bytes) }); }
    catch (error) { await this.queue.finish(claim, { errorCode: error instanceof AppError ? error.code : 'PARSE_FAILED' }); }
    return true;
  }
  stop() { this.stopping = true; }
  async start(onError: () => void) {
    while (!this.stopping) {
      try { await this.tick(); } catch { onError(); }
      if (!this.stopping) await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}
