import type { ReactNode } from 'react';

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
  const ok = status === 'ok';
  return (
    <main className="mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Newsletter</h1>
      <p className="mt-4 text-muted-foreground">
        {ok
          ? 'Your subscription is confirmed. Thank you!'
          : 'This confirmation link is invalid or has expired.'}
      </p>
    </main>
  );
}
