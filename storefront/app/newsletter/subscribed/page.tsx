import type { ReactNode } from 'react';

/** Newsletter signup outcome page (feature 048, US1). */
export default async function NewsletterSubscribedPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}): Promise<ReactNode> {
  const { status } = await searchParams;
  const message =
    status === 'active'
      ? 'You are subscribed. Thank you!'
      : status === 'error'
        ? 'We could not complete your subscription. Please try again.'
        : 'Almost there — please check your inbox and confirm your subscription.';
  return (
    <main className="mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Newsletter</h1>
      <p className="mt-4 text-muted-foreground">{message}</p>
    </main>
  );
}
