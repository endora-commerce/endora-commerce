import { customFieldCarrySkipRecord, type CustomFieldCarryPort } from '@endora-commerce/contracts';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';

/**
 * Order / Quote Request → Sales Opportunity custom-field carry
 * (`specs/162-custom-fields-value-carry/`, research R-9, data-model §4.3).
 *
 * `custom_fields` answers which of the document's values carry into the
 * Opportunity's current bag (empty fields only); CRM stores `values` in the
 * create or link Command that establishes the relationship, and that Command's
 * audit `after` gains `after` below — the Opportunity's history entry for the
 * conversion. Writes nothing itself.
 */
export interface OpportunityCarrySource {
  readonly sourceType: 'order' | 'quote_request';
  readonly recordId: string;
  readonly sourceValues: Record<string, unknown>;
}

export interface OpportunityCarryResult {
  /** The Opportunity's bag to store. */
  readonly values: Record<string, unknown>;
  /** The keys carried — `values` differs from the current bag only when this is non-empty. */
  readonly carried: readonly string[];
  /** `{}` when nothing was carried or skipped, else `{ customFieldCarry: { source, carried, skipped } }`. */
  readonly after: Record<string, unknown>;
}

export async function carryIntoOpportunity(
  port: CustomFieldCarryPort,
  source: OpportunityCarrySource,
  currentValues: Record<string, unknown>,
): Promise<OpportunityCarryResult> {
  const plan = await port.plan({
    sourceType: source.sourceType,
    targetType: 'opportunity',
    sourceValues: source.sourceValues,
    targetValues: currentValues,
  });
  const happened = plan.carried.length > 0 || plan.skipped.length > 0;
  return {
    values: plan.values,
    carried: [...plan.carried],
    after: happened
      ? {
          customFieldCarry: {
            source: { entityType: source.sourceType, recordId: source.recordId },
            carried: [...plan.carried],
            skipped: plan.skipped.map(customFieldCarrySkipRecord),
          },
        }
      : {},
  };
}

/**
 * `carryIntoOpportunity`, made a passenger: **a carry never fails the creation
 * or the link it rides on** (#405), as the origin-link path's carry does not.
 * A plan that throws answers `null` — the caller creates or links with no
 * carry — after `onFailure` was told, which is where the caller says which
 * document did not carry. A presence answer is not a failure of the carry and
 * is not absorbed (`check:port-catches`).
 */
export async function carryIntoOpportunityBestEffort(
  port: CustomFieldCarryPort,
  source: OpportunityCarrySource,
  currentValues: Record<string, unknown>,
  onFailure: (error: unknown) => void,
): Promise<OpportunityCarryResult | null> {
  try {
    return await carryIntoOpportunity(port, source, currentValues);
  } catch (error) {
    rethrowIfModuleDisabled(error);
    onFailure(error);
    return null;
  }
}
