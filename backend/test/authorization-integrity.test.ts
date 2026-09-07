import test from 'node:test';
import { withLedger } from './authorization-helpers.js';
import { integrityCases } from './authorization-integrity-cases.js';

for (const scenario of integrityCases) test(scenario.name, () => withLedger(scenario.run));
