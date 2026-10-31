import type { ReactNode } from 'react';
import { publicUnsubscribe } from '../../../lib/api/newsletter';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../lib/i18n/navigation';
import { tForLocale } from '../../../lib/i18n/messages';
import { getServerContext } from '../../../lib/server-context';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Unsubscribe landing (feature 048, US1/US9). The email link points at the
 * backend unsubscribe route, which redirects here with `?token=&valid=`. This
 * page renders an optional-reason form that POSTs the unsubscribe.
 */
export default async function NewsletterUnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; valid?: string; done?: string }>;
}): Promise<ReactNode> {
  const { token, valid, done } = await searchParams;
  const { locale } = await getServerContext();
  const t = tForLocale(locale);

  if (done === '1') {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">{t('content.newsletter.heading')}</h1>
        <p className="mt-4 text-muted-foreground">{t('content.newsletter.unsubscribe.done')}</p>
      </main>
    );
  }

  if (!token || valid === 'false') {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">{t('content.newsletter.heading')}</h1>
        <p className="mt-4 text-muted-foreground">{t('content.newsletter.unsubscribe.invalid')}</p>
      </main>
    );
  }

  async function action(formData: FormData): Promise<void> {
    'use server';
    const reason = String(formData.get('reason') ?? '').trim();
    await publicUnsubscribe(token!, reason || undefined);
    return await localeRedirect('/newsletter/unsubscribe?done=1');
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <h1 className="text-center text-2xl font-semibold">{t('content.newsletter.unsubscribe.heading')}</h1>
      <p className="mt-4 text-center text-muted-foreground">{t('content.newsletter.unsubscribe.intro')}</p>
      <form action={action} className="mt-6 flex flex-col gap-3">
        <textarea
          name="reason"
          rows={3}
          placeholder={t('content.newsletter.unsubscribe.reasonPlaceholder')}
          className="rounded border px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          {t('content.newsletter.unsubscribe.submit')}
        </button>
      </form>
    </main>
  );
}
