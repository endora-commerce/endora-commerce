import type {
  FeedFieldSourceKind,
  FeedFieldTransform,
  FeedItemGranularity,
  FeedOutputFormat,
  FeedProviderCode,
  TaxonomyProviderCode,
} from '@b2b/contracts';
import type { FeedTemplateDetail, FeedTemplateFieldDto } from './api';

/**
 * The template as it stands **on screen** — feature 067 / US4.
 *
 * Deliberately a plain, client-owned model rather than the server DTO: the
 * operator edits for minutes at a time, adding, renaming, reordering and
 * unbinding as they go, and every intermediate state has to be representable.
 * A model that could only hold valid templates would force a save (or a
 * refusal) at every keystroke, which is precisely what SC-013's "under fifteen
 * minutes, unaided" cannot afford.
 *
 * Each field carries a client-side `id` so React keys, the reorder hook and
 * focus all follow the field rather than its position. A field the server has
 * never seen gets a synthetic one.
 */

export interface DraftField {
  /** Stable across reorders. Server id when there is one, synthetic otherwise. */
  id: string;
  outputName: string;
  sourceKind: FeedFieldSourceKind;
  sourceKey: string | null;
  constantValue: string | null;
  fallbackValue: string | null;
  providerRequired: boolean;
  transform: FeedFieldTransform | null;
  transformArg: string | null;
  /** Gloss key from a predefined template; null for operator-created fields. */
  helpKey: string | null;
  /** The binding did not resolve on this installation (after an import). */
  unbound: boolean;
}

export interface TemplateDraft {
  name: string;
  description: string | null;
  providerCode: FeedProviderCode;
  outputFormat: FeedOutputFormat;
  itemGranularity: FeedItemGranularity;
  taxonomyProviderCode: TaxonomyProviderCode | null;
  fields: DraftField[];
}

let syntheticIdCounter = 0;

/** Ids for fields the server has never seen. Never sent anywhere. */
export function nextFieldId(): string {
  syntheticIdCounter += 1;
  return `draft-field-${syntheticIdCounter}`;
}

export function draftFromTemplate(template: FeedTemplateDetail): TemplateDraft {
  return {
    name: template.name,
    description: template.description,
    providerCode: template.providerCode,
    outputFormat: template.outputFormat,
    itemGranularity: template.itemGranularity,
    taxonomyProviderCode: template.taxonomyProviderCode,
    fields: template.fields.map(toDraftField),
  };
}

export function toDraftField(field: FeedTemplateFieldDto): DraftField {
  return {
    id: field.id,
    outputName: field.outputName,
    sourceKind: field.sourceKind,
    sourceKey: field.sourceKey,
    constantValue: field.constantValue,
    fallbackValue: field.fallbackValue,
    providerRequired: field.providerRequired,
    transform: field.transform,
    transformArg: field.transformArg,
    helpKey: field.helpKey,
    unbound: field.unbound,
  };
}

/** A brand-new field: named, unbound, and immediately visible as needing work. */
export function newDraftField(outputName: string): DraftField {
  return {
    id: nextFieldId(),
    outputName,
    sourceKind: 'constant',
    sourceKey: null,
    constantValue: '',
    fallbackValue: null,
    providerRequired: false,
    transform: null,
    transformArg: null,
    helpKey: null,
    unbound: false,
  };
}

/**
 * The write body. `sortOrder` is the array index, which the server then
 * normalises to `0..n-1` anyway — sending it keeps the intent explicit rather
 * than implicit in JSON array ordering.
 */
export function toWriteFields(fields: DraftField[]): Array<Record<string, unknown>> {
  return fields.map((field, index) => ({
    outputName: field.outputName.trim().replace(/\s+/g, ' '),
    sourceKind: field.sourceKind,
    sourceKey: field.sourceKey,
    constantValue: field.sourceKind === 'constant' ? (field.constantValue ?? '') : null,
    fallbackValue: field.fallbackValue,
    providerRequired: field.providerRequired,
    transform: field.transform,
    transformArg: field.transformArg,
    helpKey: field.helpKey,
    sortOrder: index,
  }));
}

// ---------------------------------------------------------------------------
// Validation (FR-073) — continuous, per field, in plain operator language
// ---------------------------------------------------------------------------

/**
 * Why a field needs attention. The key resolves in the module's own bundle and
 * the parameters fill its placeholders; the caller translates, so this stays a
 * pure function that a unit test can drive.
 */
export interface FieldProblem {
  fieldId: string;
  /** Which control caused it, so the inspector can focus exactly that one. */
  control: 'outputName' | 'source' | 'fallback' | 'template';
  messageKey: string;
  params?: Record<string, string | number>;
}

export interface ValidationContext {
  outputFormat: FeedOutputFormat;
  itemGranularity: FeedItemGranularity;
  taxonomyProviderCode: TaxonomyProviderCode | null;
  /** Source kinds the current output format cannot express. */
  unsupportedSourceKinds: Set<FeedFieldSourceKind>;
  /** Definition keys that exist on this installation. */
  knownSourceKeys: Set<string>;
  /** Label for the provider, for the "{provider} needs this" sentences. */
  providerLabel: string;
}

const KEYED_SOURCE_KINDS = new Set<FeedFieldSourceKind>(['attribute', 'custom_field']);

/**
 * Every problem in the draft, attached to the field and the control that caused
 * it. Deliberately **not** a boolean: `Save` is never disabled for validation
 * reasons (a disabled primary with invisible reasons is the classic trap), so
 * the editor needs the list itself in order to say what to fix.
 */
export function validateDraft(draft: TemplateDraft, context: ValidationContext): FieldProblem[] {
  const problems: FieldProblem[] = [];
  const byName = new Map<string, DraftField[]>();

  // The name is required by the write contract (`min(1)` after trimming), so a
  // blank one is caught here rather than as a 400 on a save the operator was
  // told would go through.
  if (draft.name.trim() === '') {
    problems.push({
      fieldId: draft.fields[0]?.id ?? '',
      control: 'template',
      messageKey: 'builder.error.nameRequired',
    });
  }

  for (const field of draft.fields) {
    const name = field.outputName.trim().replace(/\s+/g, ' ');
    const list = byName.get(name) ?? [];
    list.push(field);
    byName.set(name, list);
  }

  for (const field of draft.fields) {
    const name = field.outputName.trim();
    if (name === '') {
      problems.push({
        fieldId: field.id,
        control: 'outputName',
        messageKey: 'builder.error.emptyName',
      });
    } else if ((byName.get(name.replace(/\s+/g, ' ')) ?? []).length > 1) {
      // Reported on BOTH offending rows: telling only one of them leaves the
      // operator hunting for the other.
      problems.push({
        fieldId: field.id,
        control: 'outputName',
        messageKey: 'builder.error.duplicateName',
        params: { name },
      });
    }

    if (KEYED_SOURCE_KINDS.has(field.sourceKind)) {
      const key = field.sourceKey?.trim() ?? '';
      if (key === '') {
        problems.push({
          fieldId: field.id,
          control: 'source',
          messageKey: 'builder.error.noSource',
        });
      } else if (!context.knownSourceKeys.has(key)) {
        problems.push({
          fieldId: field.id,
          control: 'source',
          messageKey: 'builder.error.unbound',
          params: { label: key },
        });
      }
    }

    if (field.sourceKind === 'provider_category' && context.taxonomyProviderCode === null) {
      problems.push({
        fieldId: field.id,
        control: 'source',
        messageKey: 'builder.error.noTaxonomy',
      });
    }

    if (context.unsupportedSourceKinds.has(field.sourceKind)) {
      problems.push({
        fieldId: field.id,
        control: 'source',
        messageKey: 'builder.error.formatUnsupported',
      });
    }

    if (
      field.providerRequired &&
      field.sourceKind === 'constant' &&
      (field.constantValue ?? '').trim() === '' &&
      (field.fallbackValue ?? '').trim() === ''
    ) {
      problems.push({
        fieldId: field.id,
        control: 'fallback',
        messageKey: 'builder.error.requiredNoFallback',
        params: { provider: context.providerLabel },
      });
    }
  }

  if (
    context.itemGranularity === 'variant' &&
    !draft.fields.some((field) => field.sourceKind === 'grouping_id')
  ) {
    problems.push({
      fieldId: draft.fields[0]?.id ?? '',
      control: 'template',
      messageKey: 'builder.error.groupingRequired',
    });
  }

  return problems;
}

/** Problems indexed by field, for the row and inspector renderers. */
export function problemsByField(problems: FieldProblem[]): Record<string, FieldProblem[]> {
  const out: Record<string, FieldProblem[]> = {};
  for (const problem of problems) {
    (out[problem.fieldId] ??= []).push(problem);
  }
  return out;
}

/** The fields this save takes away from the provider (FR-074, client half). */
export function removedRequiredFields(
  before: DraftField[],
  after: DraftField[],
): DraftField[] {
  const kept = new Map(after.map((field) => [field.outputName, field]));
  return before.filter((field) => {
    if (!field.providerRequired) return false;
    const survivor = kept.get(field.outputName);
    return survivor === undefined || !survivor.providerRequired;
  });
}
