import { describe, expect, it } from 'vitest';
import {
  validateDraft,
  type TemplateDraft,
  type ValidationContext,
} from '../../../../packages/modules/product_feeds/src/admin/template-draft';

/**
 * The editor sends `name` on every save but never offered a control for it, so
 * a template could only be renamed by duplicating it. Adding the control means
 * the name can now be emptied, and `createFeedTemplateRequestSchema` requires
 * `min(1)` — so the blank has to surface as a normal editor problem rather than
 * as a 400 from a save the operator was told would work.
 */

function draft(over: Partial<TemplateDraft> = {}): TemplateDraft {
  return {
    name: 'Google Shopping',
    description: null,
    providerCode: 'google',
    outputFormat: 'xml',
    itemGranularity: 'product',
    taxonomyProviderCode: null,
    fields: [
      {
        id: 'f1',
        outputName: 'id',
        sourceKind: 'sku',
        sourceKey: null,
        constantValue: null,
        fallbackValue: null,
        providerRequired: true,
        transform: null,
        transformArg: null,
        helpKey: null,
      },
    ],
    ...over,
  } as TemplateDraft;
}

const context: ValidationContext = {
  outputFormat: 'xml',
  itemGranularity: 'product',
  taxonomyProviderCode: null,
  unsupportedSourceKinds: new Set(),
  knownSourceKeys: new Set(['sku']),
  providerLabel: 'Google',
};

function nameProblems(over: Partial<TemplateDraft>): ReturnType<typeof validateDraft> {
  return validateDraft(draft(over), context).filter(
    (problem) => problem.messageKey === 'builder.error.nameRequired',
  );
}

describe('validateDraft — the template name', () => {
  it('accepts a normal name', () => {
    expect(nameProblems({})).toHaveLength(0);
  });

  it('rejects an empty name', () => {
    expect(nameProblems({ name: '' })).toHaveLength(1);
  });

  it('rejects a name that is only whitespace', () => {
    // The server trims before it validates, so "   " is an empty name there.
    expect(nameProblems({ name: '   ' })).toHaveLength(1);
  });

  it('reports the blank as a template-level problem, not against a column', () => {
    const [problem] = nameProblems({ name: '' });
    expect(problem?.control).toBe('template');
  });

  it('still reports the blank when the template has no fields at all', () => {
    // The `fieldId` anchor is empty here; the bar must not drop the problem.
    expect(nameProblems({ name: '', fields: [] })).toHaveLength(1);
  });
});
