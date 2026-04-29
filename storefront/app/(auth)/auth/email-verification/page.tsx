import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * Older verification mails linked here; canonical landing is `/verify?token=`.
 */
export default async function LegacyEmailVerificationRedirect({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const token = params.token;
  if (token) {
    redirect(`/verify?token=${encodeURIComponent(token)}`);
  }
  redirect('/verify');
}
