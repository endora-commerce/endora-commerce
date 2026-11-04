import type { ReactNode } from 'react';
import { listMyOrders } from '../../../../lib/api/orders';
import {
  createReturnCase,
  getReturnable,
  listReturnReasons,
  type CreateReturnCaseInput,
} from '../../../../lib/api/returns';
import { getSessionCookie } from '../../../../lib/session';
import { getServerContext } from '../../../../lib/server-context';
import { tForLocale } from '../../../../lib/i18n/messages';
import { getMe } from '../../../../lib/api/account';
import { memberSession } from '../../../../lib/commerce-permissions';
import {
  mayStartReturn,
  parseReturnKind,
  returnFormHref,
  returnFormModel,
  type ReturnKind,
} from '../../../../lib/returns/returnForm';
import { ReturnFormLines } from '../../../../components/returns/ReturnFormLines';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../../lib/i18n/navigation';
import { LocalizedLink } from '../../../../lib/i18n/localized-link';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * New return/complaint submission (feature 046, US1). Without an `orderId` the
 * customer picks an order; with one, the order's lines are shown for selection.
 *
 * Feature 155 (FR-018, FR-020, FR-021): the kind is chosen first and carried in the address
 * (`?kind=complaint`), because what a line allows depends on it and the page works without
 * JavaScript — one decision per step (Hick's Law). In a return a non-returnable line is shown
 * with its reason and cannot be selected; in a complaint every line can. An order with no
 * returnable line (`no_returnable_lines`) no longer gets a dead end: it gets the complaint form,
 * with a sentence saying why a return is not offered (Peak-End Rule).
 */
export default async function NewReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string; kind?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login?next=/returns/new');
  const [{ orderId, kind: kindParam }, { locale }] = await Promise.all([searchParams, getServerContext()]);
  const t = tForLocale(locale);

  // Feature 170 (FR-052, FR-057): without `returns.create` the whole page would end in a refusal,
  // so it says why instead — before any order is read, as the server's gate is judged. A session
  // that cannot be read keeps today's page; `POST /api/v1/returns` is the boundary.
  const me = await getMe(session).catch(() => null);
  if (!mayStartReturn(memberSession(me))) {
    return (
      <div className="b2b-auth max-w-[720px]">
        <h1>{t('returns.new.heading')}</h1>
        <p role="note" className="rounded-md border border-line bg-surface-alt px-[14px] py-[10px] text-[13px] text-fg-soft">
          {t('account.returns.new.notAllowed')}
        </p>
        <p>
          <LocalizedLink href="/returns">{t('returns.new.backToReturns')}</LocalizedLink>
        </p>
      </div>
    );
  }

  // Step 1 — choose an order.
  if (!orderId) {
    const orders = await listMyOrders(session);
    return (
      <div className="b2b-auth max-w-[720px]">
        <h1>{t('returns.new.heading')}</h1>
        <p>{t('returns.new.chooseOrder')}</p>
        {orders.length === 0 ? (
          <p>{t('returns.new.noOrders')}</p>
        ) : (
          <ul>
            {orders.map((o) => (
              <li key={o.id}>
                <LocalizedLink href={`/returns/new?orderId=${encodeURIComponent(o.id)}`}>
                  {o.businessId} — {new Date(o.placedAt).toLocaleDateString(locale)}
                </LocalizedLink>
              </li>
            ))}
          </ul>
        )}
        <p>
          <LocalizedLink href="/returns">{t('returns.new.backToReturns')}</LocalizedLink>
        </p>
      </div>
    );
  }

  // Step 2 — pick lines + reasons.
  const [returnable, allReasons] = await Promise.all([
    getReturnable(session, orderId),
    listReturnReasons(session),
  ]);
  const model = returnFormModel(returnable, locale, parseReturnKind(kindParam));

  if (model.kind === null) {
    return (
      <div className="b2b-auth max-w-[720px]">
        <h1>{t('returns.new.heading')}</h1>
        <p>{model.notice}</p>
        <p>
          <LocalizedLink href="/returns/new">{t('returns.new.chooseAnotherOrder')}</LocalizedLink>
        </p>
      </div>
    );
  }

  const kind: ReturnKind = model.kind;
  // Only the reasons that apply to this kind: a return reason offered on a complaint is a
  // choice the buyer has to evaluate and the server would not want (Hick's Law).
  const reasons = allReasons.filter((r) => r.appliesTo === 'both' || r.appliesTo === kind);
  const selectable = new Map(
    model.lines.filter((l) => l.selectable).map((l) => [l.orderItemId, l.remainingQty]),
  );
  const backHref = returnFormHref(orderId, kind);

  async function submit(formData: FormData): Promise<void> {
    'use server';
    const s = await getSessionCookie();
    if (!s) return await localeRedirect('/login?next=/returns/new');
    const lines: CreateReturnCaseInput['lines'] = [];
    // Only the lines this kind allows: a non-returnable line posted into a return anyway (a
    // tampered form) is dropped here, and the API refuses it regardless (FR-019).
    for (const [orderItemId, remaining] of selectable) {
      if (formData.get(`include_${orderItemId}`) == null) continue;
      const quantity = Math.min(
        Math.max(1, Math.floor(Number(formData.get(`qty_${orderItemId}`) ?? 1)) || 1),
        remaining,
      );
      const reasonId = String(formData.get(`reason_${orderItemId}`) ?? '');
      if (!reasonId) continue;
      lines.push({ orderItemId, quantity, reasonId });
    }
    if (lines.length === 0) return await localeRedirect(backHref);
    const comment = String(formData.get('comment') ?? '').trim();
    const created = await createReturnCase(s, {
      orderId: orderId!,
      kind,
      lines,
      ...(comment ? { comment } : {}),
    });
    return await localeRedirect(`/returns/${created.id}`);
  }

  return (
    <div className="b2b-auth max-w-[720px]">
      <h1>{t('returns.new.heading')}</h1>
      {model.mode === 'return_and_complaint' ? (
        <nav aria-label={t('returns.new.kind.legend')} className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-muted" aria-hidden="true">
            {t('returns.new.kind.legend')}
          </span>
          {(['return', 'complaint'] as const).map((k) => (
            <LocalizedLink
              key={k}
              href={returnFormHref(orderId, k)}
              {...(k === kind ? { 'aria-current': 'page' as const } : {})}
              className={
                k === kind
                  ? 'btn btn--outline btn--sm border-fg font-semibold text-fg'
                  : 'btn btn--ghost btn--sm'
              }
            >
              {t(k === 'return' ? 'returns.new.kind.return' : 'returns.new.kind.complaint')}
            </LocalizedLink>
          ))}
        </nav>
      ) : null}
      {model.notice ? (
        <p role="note" className="rounded-md border border-line bg-surface-alt px-[14px] py-[10px] text-[13px] text-fg-soft">
          {model.notice}
        </p>
      ) : null}
      {kind === 'return' && returnable.freeReturnEligible ? (
        <p className="muted">{t('returns.new.freeReturnWindow')}</p>
      ) : null}
      {/* `noValidate`: the quantity inputs' native `min`/`max` bubble speaks the browser's
          language and refuses the whole form. `submit` brings each quantity into
          1 … remaining instead, the bound stated beside each input (U4). */}
      <form action={submit} noValidate className="b2b-auth__form">
        <ReturnFormLines lines={model.lines} reasons={reasons} locale={locale} />

        <label htmlFor="comment">{t('returns.new.comment')}</label>
        <textarea id="comment" name="comment" maxLength={2000} />

        <button type="submit">
          {t(kind === 'return' ? 'returns.new.submit.return' : 'returns.new.submit.complaint')}
        </button>
      </form>
      <p>
        <LocalizedLink href="/returns/new">{t('returns.new.chooseAnotherOrder')}</LocalizedLink>
      </p>
    </div>
  );
}
