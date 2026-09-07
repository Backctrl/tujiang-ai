import { postgres } from '../src/database.js';
import { ArtifactCipher } from './authorization-artifacts.js';
import { fail } from './authorization-contract.js';
import { AuthorizationLedger } from './authorization-ledger.js';

export function openEvaluationLedger(mode: 'runner' | 'management' | 'status') {
  const configured = process.env.TUJIANG_EVALUATION_DATABASE_URL;
  if (!configured) fail('LEDGER_DATABASE_NOT_CONFIGURED');
  let url: URL; try { url = new URL(configured); } catch { return fail('LEDGER_DATABASE_NOT_CONFIGURED'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) fail('LEDGER_DATABASE_NOT_CONFIGURED');
  const key = process.env.TUJIANG_EVALUATION_ARTIFACT_KEY;
  if (!key && mode !== 'status') fail('ARTIFACT_KEY_NOT_CONFIGURED');
  const cipher = key ? new ArtifactCipher(key) : undefined;
  const db = postgres(url.toString());
  const ledger = mode === 'management' ? AuthorizationLedger.forManagement(db, cipher) : AuthorizationLedger.forRunner(db, cipher);
  return { db, ledger, close: () => db.close() };
}
