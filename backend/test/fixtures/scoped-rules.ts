import type { CompleteContext } from '../../src/production-context.js';
import type { ScopedRulePack, ScopedConstraint, RuleSubjectScope, RuleMeasure, NumericBounds } from '../../src/production-rules.js';
import { context } from './production-context.js';

// Synthetic administrator records for tests. These fixtures are never a runtime rule catalog.
const contentType = 'amazon_basic_aplus';
export const logoScope: Extract<RuleSubjectScope, { kind: 'image_slot' }> = { kind: 'image_slot', contentType, moduleType: 'StandardCompanyLogo', slotId: 'image' };
export const headerScope: Extract<RuleSubjectScope, { kind: 'image_slot' }> = { kind: 'image_slot', contentType, moduleType: 'StandardHeaderImageText', slotId: 'block.image' };
export const numericRule = (ruleId: string, scope: ScopedConstraint['scope'], measure: RuleMeasure, bounds: NumericBounds): ScopedConstraint => ({
  ruleId, name: ruleId, description: 'Synthetic test constraint with explicit source and scope', scope, measure, severity: 'blocker',
  status: 'verified', sourceIds: ['module-fields'], constraint: { kind: 'numeric', ...bounds },
});
const formats = (ruleId: string, scope: RuleSubjectScope): ScopedConstraint => ({
  ruleId, name: ruleId, description: 'Only this test subset has source evidence; not a full format whitelist', scope, measure: 'format', severity: 'blocker',
  status: 'verified', sourceIds: ['upload-example'], constraint: { kind: 'formats', allowed: ['png', 'jpeg'], exhaustive: false },
});
export const scopedRule: ScopedRulePack = {
  schemaVersion: 'scoped-rules.1', id: 'synthetic-scoped-basic-aplus', version: '1', name: 'Synthetic scoped Basic A+ test rule',
  description: 'API shape and boundary fixture, not a published administrator rule pack',
  target: { platform: 'amazon', site: 'amazon.com', country: 'US', language: 'en-US', currency: 'USD', unitSystem: 'imperial', contentType },
  publication: { status: 'admin_verified', recordId: 'synthetic-test-review-only', actor: 'test-admin', at: '2026-01-01T00:00:00Z' },
  sources: [
    { id: 'basic-design', title: 'Basic A+ scope source', url: 'https://sell.amazon.com/blog/a-plus-content-design-guide?mons_sel_locale=en_US',
      locator: 'Basic A+ Content; modules per ASIN', kind: 'official_requirement', verifiedBy: 'test-reviewer', verifiedAt: '2026-01-01T00:00:00Z' },
    { id: 'module-fields', title: 'A+ module field source', url: 'https://developer-docs.amazon/sp-api/lang-en_US/docs/a-plus-content-examples',
      locator: 'Exact module field tables; minimum image dimensions and maxLength', kind: 'official_requirement', verifiedBy: 'test-reviewer', verifiedAt: '2026-01-01T00:00:00Z' },
    { id: 'upload-example', title: 'Upload examples only', url: 'https://developer-docs.amazon/sp-api/lang-en_US/docs/create-edit-publish-aplus-content',
      locator: 'Image upload examples; does not define a complete whitelist', kind: 'official_example', verifiedBy: 'test-reviewer', verifiedAt: '2026-01-01T00:00:00Z' },
  ],
  constraints: [
    { ...numericRule('basic-module-count', { kind: 'content', contentType }, 'moduleCount', { max: 5 }),
      status: 'verified', sourceIds: ['basic-design'], constraint: { kind: 'numeric', max: 5 } },
    numericRule('logo-width', logoScope, 'widthPx', { min: 600 }), numericRule('logo-height', logoScope, 'heightPx', { min: 180 }),
    formats('logo-format-subset', logoScope),
    numericRule('header-width', headerScope, 'widthPx', { min: 970 }), numericRule('header-height', headerScope, 'heightPx', { min: 600 }),
    formats('header-format-subset', headerScope),
    numericRule('header-headline', { kind: 'text_field', contentType, moduleType: 'StandardHeaderImageText', fieldId: 'headline' }, 'textLength', { max: 150 }),
    numericRule('header-body', { kind: 'text_field', contentType, moduleType: 'StandardHeaderImageText', fieldId: 'block.body' }, 'textLength', { max: 6000 }),
    numericRule('sidebar-body', { kind: 'text_field', contentType, moduleType: 'StandardImageSidebar', fieldId: 'descriptionTextBlock.body' }, 'textLength', { max: 500 }),
  ],
  activationRequirements: ['basic-module-count'],
  localProductionPolicy: { description: 'Synthetic employee production choices; not official Amazon image-upload specifications',
    canvasWidthPx: { min: 640, max: 2400 }, canvasFormats: ['png', 'jpeg', 'webp'], exportFormats: ['html', 'png', 'jpeg', 'webp', 'pdf'],
    maxExportImageBytes: 2 * 1024 * 1024 },
  requiredFacts: [],
};
export const scopedContext: CompleteContext = { ...context, primaryTarget: scopedRule.target,
  canvasProfile: { widthPx: 1200, format: 'webp', selectionBasis: 'local_production_policy' },
  rulePackRef: { id: scopedRule.id, version: scopedRule.version } };
