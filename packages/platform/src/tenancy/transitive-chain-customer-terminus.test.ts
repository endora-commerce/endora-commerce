import { describe, it, expect } from 'vitest';
import {
  TransitivelyScoped,
  OrgScoped,
  CustomerScoped,
  assertTransitiveParentsResolve,
} from './org-scoped.decorator.js';

/**
 * Feature 080, T054(a) (D-170) — a `customer` terminus is legal, and reported
 * rather than silent.
 *
 * Legal because it grounds: a real column, a default-on filter, and
 * `CustomerAccount` is itself `@OrgScoped`, so the customer axis narrows the org
 * axis instead of competing with it. Reported because of a measured
 * circularity — `customerFilterCond()` returns `{ customerAccountId: … }` in
 * `single-org` mode and `{}` in `allowed-set`, and the recorded remedy for the
 * rows an org-scoped admin therefore cannot filter is *transitive scoping*,
 * which is the mechanism doing the terminating.
 *
 * It lives in its own file because it is the one claim in T054(a) that requires
 * an **unpoisoned** registry: `assertTransitiveParentsResolve()` reports every
 * broken chain at once, so a single refused fixture anywhere in a file would
 * make "does not throw" unprovable. Every fixture still enters at the decorator.
 *
 * The platform has **zero** customer-terminating chains today (both real ones
 * end at `Order`, which is `@OrgScoped`), so this file is the only place the
 * line can be seen at all.
 */

interface CapturedLine {
  readonly obj: Record<string, unknown>;
  readonly msg: string;
}

function capture(): { lines: CapturedLine[]; report: { info(obj: object, msg: string): void } } {
  const lines: CapturedLine[] = [];
  return {
    lines,
    report: {
      info: (obj, msg) => {
        lines.push({ obj: obj as Record<string, unknown>, msg });
      },
    },
  };
}

describe('a customer terminus is reported, not refused', () => {
  it('accepts the chain and emits one info line naming it and the allowed-set gap', () => {
    @CustomerScoped()
    class CustomerTerminus {}

    @TransitivelyScoped('CustomerTerminus', 'customerTerminusId')
    class ChildOfACustomer {}
    void [CustomerTerminus, ChildOfACustomer];

    const { lines, report } = capture();
    expect(() => assertTransitiveParentsResolve(report)).not.toThrow();

    const mine = lines.filter((line) => line.obj.chain === 'ChildOfACustomer -> CustomerTerminus');
    expect(mine).toHaveLength(1);
    const [reported] = mine;
    if (reported === undefined) throw new Error('the chain was not reported');
    expect(reported.obj).toMatchObject({
      chain: 'ChildOfACustomer -> CustomerTerminus',
      terminus: 'CustomerTerminus',
      terminusScope: 'customer',
    });
    // The line has to name the gap, or an operator reading it learns only that a
    // chain exists — which they could already see in the decorator.
    expect(reported.msg).toMatch(/allowed-set/);
  });

  it('reports a customer terminus reached through another transitive hop', () => {
    @CustomerScoped()
    class DeepCustomerTerminus {}

    @TransitivelyScoped('DeepCustomerTerminus', 'deepCustomerTerminusId')
    class DeepCustomerMiddle {}

    @TransitivelyScoped('DeepCustomerMiddle', 'deepCustomerMiddleId')
    class DeepCustomerLeaf {}
    void [DeepCustomerTerminus, DeepCustomerMiddle, DeepCustomerLeaf];

    const { lines, report } = capture();
    expect(() => assertTransitiveParentsResolve(report)).not.toThrow();
    expect(lines.map((line) => line.obj.chain)).toContain(
      'DeepCustomerLeaf -> DeepCustomerMiddle -> DeepCustomerTerminus',
    );
  });

  it('says nothing about an org terminus', () => {
    @OrgScoped()
    class QuietOrgTerminus {}

    @TransitivelyScoped('QuietOrgTerminus', 'quietOrgTerminusId')
    class QuietOrgChild {}
    void [QuietOrgTerminus, QuietOrgChild];

    const { lines, report } = capture();
    expect(() => assertTransitiveParentsResolve(report)).not.toThrow();
    // Filtered rather than length-checked: the fixtures above are still in the
    // registry and are still legitimately reported.
    expect(lines.filter((line) => String(line.obj.chain).startsWith('QuietOrgChild'))).toEqual([]);
  });
});
