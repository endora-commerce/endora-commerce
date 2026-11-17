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

// ---------------------------------------------------------------------------
// `specs/180-off-platform-complaints/` phase B — the form posts to a route handler
// (research R-13), which reads the post with these pure functions.
// ---------------------------------------------------------------------------

/** The no-JS attempt kept across a refusal: the typed answers, the refusals, the files already accepted. */
export const RETURNS_ATTEMPT_COOKIE = 'returns_attempt';
/** Seconds the attempt is kept: long enough to read the page again, not to keep personal data. */
export const RETURNS_ATTEMPT_MAX_AGE = 600;
/** The cookie value's budget in bytes, under every browser's 4 KiB per-cookie limit. */
const RETURNS_ATTEMPT_BUDGET = 3600;

/** How many product lines the no-order form offers (design review R-2.1). */
export const OFF_PLATFORM_FORM_LINES = 5;

export interface ReturnsAttemptUpload {
  readonly uploadId: string;
  readonly filename: string;
  readonly type: 'photo' | 'proof_of_purchase' | 'other';
  /** The form's line slot a photo was given for (`lines.N.…`); absent for the whole case. */
  readonly line?: number;
}

export interface ReturnsAttempt {
  readonly answers: Record<string, string>;
  /** Refusal codes: the API's `error.code`, a detail code, or the form's own. */
  readonly errors: string[];
  readonly uploads: ReturnsAttemptUpload[];
}

/** Encode an attempt, dropping long answers first so the cookie stays within its budget. */
export function encodeReturnsAttempt(attempt: ReturnsAttempt): string {
  const encode = (a: ReturnsAttempt): string => Buffer.from(JSON.stringify(a), 'utf8').toString('base64url');
  let value = encode(attempt);
  if (value.length <= RETURNS_ATTEMPT_BUDGET) return value;
  const answers = Object.entries(attempt.answers).sort(([, a], [, b]) => a.length - b.length);
  const kept: Record<string, string> = {};
  for (const [key, answer] of answers) {
    kept[key] = answer;
    if (encode({ ...attempt, answers: kept }).length > RETURNS_ATTEMPT_BUDGET) {
      delete kept[key];
      break;
    }
  }
  value = encode({ ...attempt, answers: kept });
  return value;
}

export function decodeReturnsAttempt(raw: string | undefined): ReturnsAttempt | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<ReturnsAttempt>;
    return {
      answers: typeof parsed.answers === 'object' && parsed.answers ? (parsed.answers as Record<string, string>) : {},
      errors: Array.isArray(parsed.errors) ? parsed.errors.filter((e): e is string => typeof e === 'string') : [],
      uploads: Array.isArray(parsed.uploads) ? (parsed.uploads as ReturnsAttemptUpload[]) : [],
    };
  } catch {
    return null;
  }
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** The typed answers of a post (never a file) — what a refused attempt gives back. */
export function answersOf(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of form.entries()) {
    // Files and upload ids travel as `uploads`, not as answers.
    if (typeof value !== 'string' || name === 'submissionKey' || name.includes('files_')) continue;
    if (name.endsWith('uploadId') || name.endsWith('keepUpload')) continue;
    if (name in out) continue;
    out[name] = value;
  }
  return out;
}

/** `YYYY-MM-DD`, also from `DD.MM.YYYY` / `D.M.YYYY` where the browser has no date control (Postel). */
export function parsePurchaseDate(raw: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) return raw;
  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(raw);
  if (!dotted) return null;
  return `${dotted[3]}-${dotted[2]!.padStart(2, '0')}-${dotted[1]!.padStart(2, '0')}`;
}

/** `shownClause` / `accept` values are `id:revision` (FR-B31). */
function clauseRefs(form: FormData, name: string): Array<{ id: string; revision: number }> {
  return form
    .getAll(name)
    .filter((v): v is string => typeof v === 'string')
    .map((v) => {
      const [id, revision] = v.split(':');
      return { id: id ?? '', revision: Number(revision) };
    })
    .filter((c) => c.id !== '' && Number.isInteger(c.revision) && c.revision > 0);
}

export function clausesOf(form: FormData): { shownClauses?: Array<{ id: string; revision: number }>; acceptedClauses?: Array<{ id: string; revision: number }> } {
  const shown = clauseRefs(form, 'shownClause');
  if (shown.length === 0) return {};
  return { shownClauses: shown, acceptedClauses: clauseRefs(form, 'accept') };
}

/** A posted quantity, at least 1. */
function quantityOf(raw: string): number {
  return Math.max(1, Math.floor(Number(raw)) || 1);
}

/** The complaint without an order, as the no-JS form posts it (customer-api.md §C3), and what is missing. */
export function offPlatformBodyOf(form: FormData): { body: Record<string, unknown>; errors: string[]; slots: number[] } {
  const errors: string[] = [];
  const lines: Array<Record<string, unknown>> = [];
  /** The form slot of each line sent, so a line's photos find their line once empty slots drop out. */
  const slots: number[] = [];
  for (let i = 0; i < OFF_PLATFORM_FORM_LINES; i += 1) {
    const productId = text(form, `lines.${i}.productId`);
    const modelName = text(form, `lines.${i}.modelName`);
    const description = text(form, `lines.${i}.description`);
    const photos = lineUploadsOf(form, i).length > 0 || lineFilesOf(form, i).length > 0;
    // An unopened `<details>` posts empty fields: a line with nothing in it is no line.
    if (!productId && !modelName && !description && !photos) continue;
    slots.push(i);
    // The API requires both on every line (customer-api.md §C3); refused here, a line says
    // which answer it lacks instead of a bare validation failure.
    if (!productId && !modelName && !errors.includes('product_missing')) errors.push('product_missing');
    if (!text(form, `lines.${i}.reasonId`) && !errors.includes('reason_missing')) errors.push('reason_missing');
    if (!description && !errors.includes('description_missing')) errors.push('description_missing');
    lines.push({
      ...(productId ? { productId } : { modelName }),
      quantity: quantityOf(text(form, `lines.${i}.quantity`)),
      reasonId: text(form, `lines.${i}.reasonId`),
      description,
      ...(text(form, `lines.${i}.serialNumber`) ? { serialNumber: text(form, `lines.${i}.serialNumber`) } : {}),
    });
  }
  if (lines.length === 0) errors.push('no_line');
  const date = parsePurchaseDate(text(form, 'purchase.date'));
  if (!date) errors.push('purchase_date');
  const contact = {
    name: text(form, 'contact.name'),
    email: text(form, 'contact.email'),
    ...(text(form, 'contact.phone') ? { phone: text(form, 'contact.phone') } : {}),
  };
  if (!contact.name || !contact.email) errors.push('contact');
  const returnAddress = {
    name: text(form, 'returnAddress.name') || contact.name,
    ...(text(form, 'returnAddress.company') ? { company: text(form, 'returnAddress.company') } : {}),
    street: text(form, 'returnAddress.street'),
    postalCode: text(form, 'returnAddress.postalCode'),
    city: text(form, 'returnAddress.city'),
    countryCode: text(form, 'returnAddress.country').toUpperCase(),
    // One phone, not two (design review R-2.3).
    ...(contact.phone ? { phone: contact.phone } : {}),
  };
  if (!returnAddress.street || !returnAddress.postalCode || !returnAddress.city || !returnAddress.countryCode) {
    errors.push('returnAddress');
  }
  const proofNumber = text(form, 'purchase.proofNumber');
  return {
    body: {
      orderId: null,
      kind: 'complaint',
      lines,
      purchase: { date: date ?? '', ...(proofNumber ? { proofNumber } : {}) },
      contact,
      returnAddress,
      ...clausesOf(form),
      ...(text(form, 'comment') ? { comment: text(form, 'comment') } : {}),
    },
    errors,
    slots,
  };
}

/** The upload ids posted for one line slot: uploaded by the JS field, or kept from a refused attempt. */
export function lineUploadsOf(form: FormData, slot: number): string[] {
  return [...form.getAll(`lines.${slot}.uploadId`), ...form.getAll(`lines.${slot}.keepUpload`)]
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/** The photo files posted for one line slot without JavaScript. */
export function lineFilesOf(form: FormData, slot: number): File[] {
  return form.getAll(`lines.${slot}.files_photo`).filter((v): v is File => typeof v !== 'string' && v.size > 0);
}

/** A case against an order, as the order form posts it (feature 046 lines, 180 clauses and files). */
export function orderBodyOf(form: FormData): { body: Record<string, unknown>; errors: string[] } {
  const kind = parseReturnKind(text(form, 'kind'));
  const lines: Array<Record<string, unknown>> = [];
  for (const [name, value] of form.entries()) {
    if (!name.startsWith('include_') || typeof value !== 'string') continue;
    const orderItemId = name.slice('include_'.length);
    const reasonId = text(form, `reason_${orderItemId}`);
    if (!reasonId) continue;
    const remaining = Math.floor(Number(text(form, `remaining_${orderItemId}`)));
    const quantity = quantityOf(text(form, `qty_${orderItemId}`));
    lines.push({ orderItemId, quantity: remaining >= 1 ? Math.min(quantity, remaining) : quantity, reasonId });
  }
  return {
    body: {
      orderId: text(form, 'orderId'),
      kind,
      lines,
      ...clausesOf(form),
      ...(text(form, 'comment') ? { comment: text(form, 'comment') } : {}),
    },
    errors: lines.length === 0 ? ['no_line'] : [],
  };
}
