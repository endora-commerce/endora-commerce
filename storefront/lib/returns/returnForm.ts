import type { ReturnableLine, ReturnableResponse } from '../api/returns';
import { tForLocale } from '../i18n/messages';
import { can, type OrganizationPermissionSession } from '../organization-permissions';

/**
 * Feature 155 (FR-018, FR-020, FR-021) — the storefront's reading of an order's returnability
 * (`contracts/returns-api.md` §2): what the return form offers and which action the order
 * detail shows.
 *
 * The server judges (`POST /api/v1/returns` refuses a non-returnable line in a `return` case);
 * these helpers only keep the interface from offering what it would refuse. Pure and React-free
 * so the server-rendered pages share one answer and the node-only tests can assert it.
 */

export type ReturnKind = 'return' | 'complaint';

/**
 * - `return_and_complaint` — at least one line is returnable: both kinds are offered.
 * - `complaint_only` — no line is returnable (`no_returnable_lines`): a complaint only. Until
 *   this feature `eligible: false` replaced the whole form, which also stopped complaints.
 * - `none` — the order is not completed, fully returned, or past its window.
 */
export type ReturnFormMode = 'return_and_complaint' | 'complaint_only' | 'none';

export interface ReturnFormLine {
  orderItemId: string;
  name: string;
  remainingQty: number;
  /** May the line be included in a `return` case? */
  returnable: boolean;
  /** The translated reason a line is not returnable, else `null`. Shown in both kinds. */
  notReturnableText: string | null;
  /** Selectable in the form's current kind: always for a complaint (FR-020). */
  selectable: boolean;
}

export interface ReturnFormModel {
  mode: ReturnFormMode;
  /** The kind the form files, or `null` when it files nothing. */
  kind: ReturnKind | null;
  /** The sentence above the form, or `null` when there is nothing to say. */
  notice: string | null;
  /** Lines with something left to return or complain about; empty in `none` mode. */
  lines: ReturnFormLine[];
}

function modeOf(returnable: ReturnableResponse): ReturnFormMode {
  if (returnable.eligible) return 'return_and_complaint';
  if (returnable.reason === 'no_returnable_lines') return 'complaint_only';
  return 'none';
}

function lineIsReturnable(line: ReturnableLine): boolean {
  // Fail closed only on an explicit `false`: the contract makes the field required.
  return line.returnable !== false;
}

/**
 * What the return form offers for this order. `requestedKind` is the kind the buyer chose
 * (`?kind=` on the page); a `complaint_only` order files a complaint whatever was asked.
 */
export function returnFormModel(
  returnable: ReturnableResponse,
  locale: string,
  requestedKind: ReturnKind = 'return',
): ReturnFormModel {
  const t = tForLocale(locale);
  const mode = modeOf(returnable);
  if (mode === 'none') {
    const notice =
      returnable.reason === 'order_not_completing'
        ? t('returns.new.none.notCompleting')
        : returnable.reason === 'fully_returned'
          ? t('returns.new.none.fullyReturned')
          : returnable.reason === 'window_passed'
            ? t('returns.new.none.windowPassed')
            : t('returns.new.none.generic');
    return { mode, kind: null, notice, lines: [] };
  }
  const kind: ReturnKind = mode === 'complaint_only' ? 'complaint' : requestedKind;
  const lines = returnable.lines
    .filter((l) => l.remainingReturnableQty > 0)
    .map((l): ReturnFormLine => {
      const isReturnable = lineIsReturnable(l);
      return {
        orderItemId: l.orderItemId,
        name: l.name,
        remainingQty: l.remainingReturnableQty,
        returnable: isReturnable,
        // One reason exists today (`product_not_returnable`); an unknown future one reads the same.
        notReturnableText: isReturnable ? null : t('returns.line.notReturnable'),
        selectable: kind === 'complaint' || isReturnable,
      };
    });
  return {
    mode,
    kind,
    notice: mode === 'complaint_only' ? t('returns.new.complaintOnly') : null,
    lines,
  };
}

/** Reads the page's `?kind=` — anything but `complaint` is a return. */
export function parseReturnKind(raw: string | string[] | undefined): ReturnKind {
  return raw === 'complaint' ? 'complaint' : 'return';
}

/** The return form's address for an order and kind (a return is the default, unnamed). */
export function returnFormHref(orderId: string, kind: ReturnKind): string {
  const base = `/returns/new?orderId=${encodeURIComponent(orderId)}`;
  return kind === 'complaint' ? `${base}&kind=complaint` : base;
}

export interface OrderReturnAction {
  kind: ReturnKind;
  label: string;
  href: string;
}

/**
 * The entry point the order detail shows (FR-021): a return (the form offers complaints too)
 * when the order is eligible, a complaint for `no_returnable_lines`, nothing otherwise.
 *
 * Feature 170 (FR-052, FR-057): `mayOpen` is `mayStartReturn(session)` — a member whose role
 * cannot open a case is offered neither entry, whatever the order allows.
 */
export function orderReturnAction(
  returnable: ReturnableResponse,
  orderId: string,
  locale: string,
  mayOpen: boolean,
): OrderReturnAction | null {
  if (!mayOpen) return null;
  const t = tForLocale(locale);
  const mode = modeOf(returnable);
  if (mode === 'return_and_complaint') {
    return { kind: 'return', label: t('orders.returnAction.return'), href: returnFormHref(orderId, 'return') };
  }
  if (mode === 'complaint_only') {
    return {
      kind: 'complaint',
      label: t('orders.returnAction.complaint'),
      href: returnFormHref(orderId, 'complaint'),
    };
  }
  return null;
}

/** The organization permission that opens a return or a complaint (feature 170, FR-052). */
const RETURNS_CREATE = 'returns.create';

/**
 * Whether the member may open a return or a complaint — `returns.create` (feature 170, FR-052,
 * FR-057). `null` is a session `/api/v1/me` did not answer for: the page stays as it was before
 * roles existed and the server's gate words any refusal, as `commerceAbilities` does for the
 * commerce surfaces. Presentation only; `POST /api/v1/returns` is the boundary.
 */
export function mayStartReturn(session: OrganizationPermissionSession | null | undefined): boolean {
  if (!session) return true;
  return can(session, RETURNS_CREATE);
}

/**
 * Whether a case was filed by someone other than the viewer — a colleague's case, which a holder
 * of `returns.view_organization` reads but cannot act on (feature 170, FR-053, Q-R2 = A). Either
 * id unknown reads as the viewer's own case: the page as today, the server answering `404` to a
 * follow-up that is not theirs.
 */
export function filedByColleague(filerId: string | null | undefined, viewerId: string | null | undefined): boolean {
  return Boolean(filerId && viewerId && filerId !== viewerId);
}
