import { describe, expectTypeOf, it } from 'vitest';
import type {
  AdminZoneName,
  AdminZoneProps,
  EditorSaveSessionHandle,
} from './admin-contributions.js';

/**
 * Feature 180 (`specs/180-one-save-zone-editors/contracts/save-participation.md` §1, FR-002) —
 * a zone contribution can take part in its host editor's one Save only where the host offers a
 * save session, and the offer is a prop of the zone's contract, so `tsc` refuses a contribution
 * that reaches for a session where there is none.
 *
 * The cases are type-level: they are held by `tsc` when the package is type-checked, and the
 * `it` blocks only give vitest something to report.
 */

/** The zones whose host editor offers a save session (spec § *Editors that adopt*). */
type AdoptingZone =
  | 'product.editor.details.before'
  | 'product.editor.pricing.before'
  | 'product.editor.pricing.after'
  | 'product.editor.channels'
  | 'product.editor.field.after'
  | 'category.editor.after'
  | 'organization.detail.after'
  | 'customer.detail.after'
  | 'sales_channel.editor.after';

/** Distributive, so one non-adopting zone that gained a handle makes the union non-`never`. */
type SessionOf<Z extends AdminZoneName> = Z extends AdminZoneName
  ? AdminZoneProps<Z> extends { readonly saveSession: infer H }
    ? H
    : never
  : never;

describe('the save-session handle in the zone contract', () => {
  it('is required on every zone an adopting editor mounts', () => {
    expectTypeOf<SessionOf<'product.editor.details.before'>>().toEqualTypeOf<EditorSaveSessionHandle>();
    expectTypeOf<SessionOf<'product.editor.pricing.before'>>().toEqualTypeOf<EditorSaveSessionHandle>();
    expectTypeOf<SessionOf<'product.editor.pricing.after'>>().toEqualTypeOf<EditorSaveSessionHandle>();
    expectTypeOf<SessionOf<'product.editor.channels'>>().toEqualTypeOf<EditorSaveSessionHandle>();
    expectTypeOf<SessionOf<'product.editor.field.after'>>().toEqualTypeOf<EditorSaveSessionHandle>();
    expectTypeOf<SessionOf<'category.editor.after'>>().toEqualTypeOf<EditorSaveSessionHandle>();
    expectTypeOf<SessionOf<'organization.detail.after'>>().toEqualTypeOf<EditorSaveSessionHandle>();
    expectTypeOf<SessionOf<'customer.detail.after'>>().toEqualTypeOf<EditorSaveSessionHandle>();
    expectTypeOf<SessionOf<'sales_channel.editor.after'>>().toEqualTypeOf<EditorSaveSessionHandle>();

    // Required, not optional: a host that adopts cannot forget to pass it.
    // @ts-expect-error — `saveSession` is missing.
    const missing: AdminZoneProps<'product.editor.pricing.after'> = { productId: 'p' };
    void missing;
  });

  it('is absent on the SEO zone, which stays in the host’s own atomic write (FR-023)', () => {
    expectTypeOf<SessionOf<'product.editor.seo'>>().toBeNever();
  });

  it('is absent on every zone whose host does not adopt', () => {
    type NonAdopting = Exclude<AdminZoneName, AdoptingZone | 'product.editor.seo'>;
    expectTypeOf<SessionOf<NonAdopting>>().toBeNever();

    const handle = { sessionId: 's' } satisfies EditorSaveSessionHandle;
    // @ts-expect-error — the order detail offers no session (spec § *Zone hosts that do not change*).
    const order: AdminZoneProps<'order.detail.after'> = { orderId: 'o', saveSession: handle };
    void order;

    // @ts-expect-error — the organization Sales tab is not part of the Commerce one Save (#1452).
    const sales: AdminZoneProps<'organization.detail.sales'> = { organizationId: 'o', saveSession: handle };
    void sales;
  });

  it('carries no function in its public type, so contracts stays free of React', () => {
    expectTypeOf<EditorSaveSessionHandle>().toEqualTypeOf<{ readonly sessionId: string }>();
  });
});
