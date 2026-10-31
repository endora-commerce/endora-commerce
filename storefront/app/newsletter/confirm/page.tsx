import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { tForLocale } from '../../../lib/i18n/messages';
import { getServerContext } from '../../../lib/server-context';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Double opt-in confirmation landing (feature 048, US1). The backend confirm
 * route activates the subscriber then redirects here with `?status=ok|invalid`.
 */
export default async function NewsletterConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}): Promise<ReactNode> {
  const { status } = await searchParams;
  const { locale } = await getServerContext();
  const t = tForLocale(locale);
  const ok = status === 'ok';
  return (
    <main className="mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">{t('content.newsletter.heading')}</h1>
      <p className="mt-4 text-muted-foreground">
        {ok ? t('content.newsletter.confirm.ok') : t('content.newsletter.confirm.invalid')}
      </p>
    </main>
  );
}
