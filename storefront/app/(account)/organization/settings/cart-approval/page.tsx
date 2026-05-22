import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { setCartApprovalPolicy } from '../../../../../lib/api/cart';
import { getSessionCookie, getAnonCartCookie } from '../../../../../lib/session';
import { getMe } from '../../../../../lib/api/account';

/**
 * Cart-approval policy toggle (feature 027 US4).
 *
 * Org-Admin-only. Two server-action forms (turn-on / turn-off). Reading
 * the current value goes through `/api/v1/me` (the Organization payload
 * doesn't yet expose `requiresCartApproval`; until it does, we surface
 * a "status unknown — submit to change" affordance and rely on the
 * backend's idempotent setPolicyForOrganization).
 *
 * Browser-verification note: the form-action UX and the policy-off
 * cascading reset (every pending/approved cart in the Org returns to
 * not_required) need eyes.
 */
export default async function CartApprovalPolicyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const me = await getMe(session);
  if (me.customerAccount.role !== 'organization_admin') {
    return (
      <>
        <h2>Cart approval policy</h2>
        <p className="b2b-auth__error">
          Only Organization Administrators can change this policy.
        </p>
      </>
    );
  }

  return (
    <>
      <h2>Cart approval policy</h2>
      <p className="b2b-auth__hint">
        When this policy is on, ordinary members of {me.organization.name}{' '}
        must submit their cart for an Organization Administrator's
        approval before checkout. Turning it off immediately returns
        every pending or approved cart in the Organization to
        not-required.
      </p>

      {params.ok ? (
        <p className="b2b-auth__hint" style={{ color: '#3a7' }}>
          {params.ok === 'on' ? 'Policy turned on.' : 'Policy turned off.'}
        </p>
      ) : null}
      {params.error ? (
        <p className="b2b-auth__error">{params.error}</p>
      ) : null}

      <div className="b2b-auth__actions" style={{ gap: '1rem', marginTop: '1rem' }}>
        <form action={turnOnAction}>
          <button type="submit">Require cart approval</button>
        </form>
        <form action={turnOffAction}>
          <button type="submit">No approval required</button>
        </form>
      </div>
    </>
  );
}

async function turnOnAction(_formData: FormData): Promise<void> {
  'use server';
  await applyPolicy(true);
}

async function turnOffAction(_formData: FormData): Promise<void> {
  'use server';
  await applyPolicy(false);
}

async function applyPolicy(requiresCartApproval: boolean): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  const anon = await getAnonCartCookie();
  if (!session) redirect('/login');
  try {
    await setCartApprovalPolicy(
      {
        ...(session ? { session } : {}),
        ...(anon ? { anon } : {}),
      },
      requiresCartApproval,
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Could not update the policy.';
    redirect(`/organization/settings/cart-approval?error=${encodeURIComponent(message)}`);
  }
  redirect(`/organization/settings/cart-approval?ok=${requiresCartApproval ? 'on' : 'off'}`);
}
