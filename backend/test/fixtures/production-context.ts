import type { CompleteContext, RulePack } from '../../src/production-context.js';

// Synthetic test-only rule; never used by the production directory.
export const rule: RulePack = { id: 'synthetic', version: '1', officialUrl: 'https://example.org/synthetic-test-rule',
  verifiedAt: '2026-01-01T00:00:00Z', verifiedBy: 'test-reviewer',
  target: { platform: 'test', site: 'test-us', country: 'US', language: 'en-US', currency: 'USD', unitSystem: 'imperial' },
  allowedWidthsPx: [1000], allowedFormats: ['png'], requiredFacts: [{ key: 'identity', description: 'Test identity', allowUnknown: false, allowNotApplicable: false }] };
export const context: CompleteContext = { productBrief: { productName: 'Test chair', internalCode: 'T1', category: 'chair', stage: 'new',
  introduction: 'Test only', commercialIntent: 'Test launch' }, primaryTarget: rule.target,
  canvasProfile: { widthPx: 1000, format: 'png' }, rulePackRef: { id: rule.id, version: rule.version } };
