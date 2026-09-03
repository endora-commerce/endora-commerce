import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { publicUnsubscribe } from '../../../lib/api/newsletter';
import type { Metadata } from 'next';

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

  if (done === '1') {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">Newsletter</h1>
        <p className="mt-4 text-muted-foreground">You have been unsubscribed. We are sorry to see you go.</p>
      </main>
    );
  }

  if (!token || valid === 'false') {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">Newsletter</h1>
        <p className="mt-4 text-muted-foreground">This unsubscribe link is invalid or has expired.</p>
      </main>
    );
  }

  async function action(formData: FormData): Promise<void> {
    'use server';
    const reason = String(formData.get('reason') ?? '').trim();
    await publicUnsubscribe(token!, reason || undefined);
    redirect('/newsletter/unsubscribe?done=1');
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <h1 className="text-center text-2xl font-semibold">Unsubscribe</h1>
      <p className="mt-4 text-center text-muted-foreground">
        Confirm you want to stop receiving our newsletter. You may optionally tell us why.
      </p>
      <form action={action} className="mt-6 flex flex-col gap-3">
        <textarea
          name="reason"
          rows={3}
          placeholder="Reason (optional)"
          className="rounded border px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          Unsubscribe
        </button>
      </form>
    </main>
  );
}
