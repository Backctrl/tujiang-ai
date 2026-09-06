import { applyOutput, checkSkillInputs, failureCode } from './domain.js';
import type { ModelGateway } from './openrouter.js';
import { Store } from './store.js';
import type { ModelObservation } from './contracts.js';

export class Worker {
  private stopping = false;
  constructor(private store: Store, private model: ModelGateway) {}
  async tick() {
    const job = await this.store.claim(skill => this.model.modelFor?.(skill));
    if (!job) return false;
    const { project, run } = job;
    let observation: ModelObservation | undefined;
    let output: unknown;
    const record = (current: typeof run, errorCode?: string) => {
      if (observation) (current.observations ??= []).push({ ...observation, attempt: run.attempt, ...(errorCode ? { errorCode } : {}) });
    };
    try {
      checkSkillInputs(project, run.skill, run);
      output = await this.model.generate(run.skill, project, value => { observation = value; }, run);
      await this.store.finish(project.id, run.id, run.attempt, (p, current) => { applyOutput(p, current, output); record(current); }, observation);
    } catch (error) {
      const code = failureCode(error);
      await this.store.finish(project.id, run.id, run.attempt, (_p, current) => {
        current.runStatus = 'failed'; current.errorCode = code;
        record(current, code);
        if (observation && !observation.errorCode) current.output = output;
        if (code === 'STALE_INPUT') current.freshness = 'stale';
      }, observation);
    }
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
