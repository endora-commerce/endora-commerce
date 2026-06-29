import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getNewsletterStatus, subscribeNewsletter } from '../../lib/api/newsletter';

/**
 * Reusable newsletter signup form (feature 048, US1). Server-action form that
 * subscribes the entered email on the given sales channel, attaching any
 * preset tags (e.g. a "Promotions" footer form passes `tags={['promotions']}`).
 * Renders nothing when the newsletter module is disabled. Redirects to a
 * thank-you page reflecting the opt-in outcome.
 */
export async function NewsletterSignup({
  channelCode,
  tags,
  title = 'Subscribe to our newsletter',
}: {
  channelCode: string;
  tags?: string[];
  title?: string;
}): Promise<ReactNode> {
  const status = await getNewsletterStatus(channelCode);
  if (!status.enabled) return null;

  async function action(formData: FormData): Promise<void> {
    'use server';
    const email = String(formData.get('email') ?? '').trim();
    if (!email) redirect('/newsletter/subscribed?status=error');
    let status: 'pending' | 'active' = 'pending';
    try {
      const res = await subscribeNewsletter({
        email,
        channelCode,
        ...(tags ? { tags } : {}),
        source: 'storefront',
      });
      status = res.status;
    } catch {
      redirect('/newsletter/subscribed?status=error');
    }
    redirect(`/newsletter/subscribed?status=${status}`);
  }

  return (
    <form action={action} className="newsletter-signup flex flex-col gap-2 sm:flex-row">
      <label className="sr-only" htmlFor="newsletter-email">
        Email
      </label>
      <input
        id="newsletter-email"
        type="email"
        name="email"
        required
        placeholder="you@example.com"
        aria-label={title}
        className="flex-1 rounded border px-3 py-2 text-sm"
      />
      <button type="submit" className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
        Subscribe
      </button>
    </form>
  );
}
