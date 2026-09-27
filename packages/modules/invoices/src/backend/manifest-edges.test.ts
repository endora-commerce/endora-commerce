import { describe, expect, it } from 'vitest';
import { manifest } from '../manifest.js';

/**
 * Feature 134, T065 (`research.md` D12) — `invoices` declares no edge onto a
 * connector.
 *
 * The attachment download used to resolve a port a connector owned, so this
 * manifest carried a `refuses-without` row naming that connector. The seam is
 * `invoices`' own now: a connector registers its fetch provider into it, and
 * the connector's manifest carries the edge. An edge from here to a connector
 * would put the dependency back the wrong way round.
 */
describe('invoices manifest', () => {
  it('names only the invoice ledger among its non-binding edges', () => {
    expect((manifest.nonBindingDependencies ?? []).map((edge) => edge.moduleId)).toEqual([
      'invoice_ledger',
    ]);
  });
});
