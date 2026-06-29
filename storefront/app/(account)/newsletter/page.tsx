import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getSessionCookie } from '../../../lib/session';
import {
  getSelfNewsletter,
  selfSubscribeNewsletter,
  selfUnsubscribeNewsletter,
} from '../../../lib/api/newsletter';

/**
 * Customer account newsletter panel (feature 048, US9). Shows whether the
 * signed-in customer is subscribed and which tags they hold, and lets them
 * subscribe / unsubscribe (with an optional reason).
 */
export default async function AccountNewsletterPage(): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) redirect('/login?next=/newsletter');

  const status = await getSelfNewsletter(session);

  async function subscribe(): Promise<void> {
    'use server';
    const s = await getSessionCookie();
    if (!s) redirect('/login?next=/newsletter');
    await selfSubscribeNewsletter(s);
    redirect('/newsletter');
  }

  async function unsubscribe(formData: FormData): Promise<void> {
    'use server';
    const s = await getSessionCookie();
    if (!s) redirect('/login?next=/newsletter');
    const reason = String(formData.get('reason') ?? '').trim();
    await selfUnsubscribeNewsletter(s, reason || undefined);
    redirect('/newsletter');
  }

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Newsletter</h1>
      {status.subscribed ? (
        <>
          <p className="text-sm">
            You are <strong>subscribed</strong>.
          </p>
          {status.tags.length > 0 ? (
            <p className="text-sm text-muted-foreground">Tags: {status.tags.map((t) => t.name).join(', ')}</p>
          ) : null}
          <form action={unsubscribe} className="flex flex-col gap-2 sm:max-w-md">
            <textarea name="reason" rows={2} placeholder="Reason (optional)" className="rounded border px-3 py-2 text-sm" />
            <button type="submit" className="self-start rounded border px-4 py-2 text-sm font-medium">
              Unsubscribe
            </button>
          </form>
        </>
      ) : (
        <>
          <p className="text-sm">You are not subscribed to our newsletter.</p>
          <form action={subscribe}>
            <button type="submit" className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              Subscribe
            </button>
          </form>
        </>
      )}
    </section>
  );
}
