'use server';

import {
  acceptPayerRequest,
  rejectPayerRequest,
  revokePayerLinkFrom,
  sendPayeeInvitation,
  sendPayerRequest,
  withdrawPayeeInvitation,
  withdrawPayerRequest,
} from '../../../lib/api/related-payers';
import { getSessionCookie } from '../../../lib/session';
import { getServerContext } from '../../../lib/server-context';
import { localeRedirect } from '../../../lib/i18n/navigation';
import { PAYERS_ERRORS } from '../../../components/account/Payers';

/**
 * `specs/182-related-payers/` US4 + US7 — the **Payers** page's writes. Each redirects back with
 * `?done=<what>` or `?error=<code>`: a code, never the API's sentence or what the member typed
 * (issue #740). The permission, the channel and whose request or link it is are the API's to check.
 */

const PAGE = '/payers';

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

/** One write, then back to the page: `success` on the way out, the refusal's code otherwise. */
async function run(write: (session: string) => Promise<void>, success: string): Promise<void> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login?next=/payers');
  try {
    await write(session);
  } catch (err) {
    return await localeRedirect(`${PAGE}?error=${PAYERS_ERRORS.failureCode(err, 'FAILED')}`);
  }
  return await localeRedirect(success);
}

export async function requestPayerAction(formData: FormData): Promise<void> {
  const { ctx } = await getServerContext();
  const comment = text(formData, 'comment');
  await run(
    (session) =>
      sendPayerRequest(session, ctx, {
        taxId: text(formData, 'taxId'),
        contactEmail: text(formData, 'contactEmail'),
        ...(comment !== '' ? { comment } : {}),
      }),
    '/payers?done=requested',
  );
}

/** US6 — a payer invites a buyer it will pay for. */
export async function invitePayeeAction(formData: FormData): Promise<void> {
  const { ctx } = await getServerContext();
  const comment = text(formData, 'comment');
  await run(
    (session) =>
      sendPayeeInvitation(session, ctx, {
        taxId: text(formData, 'taxId'),
        contactEmail: text(formData, 'contactEmail'),
        ...(comment !== '' ? { comment } : {}),
      }),
    '/payers?done=invited',
  );
}

/** FR-045 — a payer takes back a pending invitation. */
export async function withdrawPayeeInvitationAction(formData: FormData): Promise<void> {
  const { ctx } = await getServerContext();
  await run((session) => withdrawPayeeInvitation(session, ctx, text(formData, 'requestId')), '/payers?done=withdrawn');
}

export async function withdrawPayerRequestAction(formData: FormData): Promise<void> {
  const { ctx } = await getServerContext();
  await run((session) => withdrawPayerRequest(session, ctx, text(formData, 'requestId')), '/payers?done=withdrawn');
}

export async function acceptPayerRequestAction(formData: FormData): Promise<void> {
  const { ctx } = await getServerContext();
  await run((session) => acceptPayerRequest(session, ctx, text(formData, 'requestId')), '/payers?done=accepted');
}

export async function rejectPayerRequestAction(formData: FormData): Promise<void> {
  const { ctx } = await getServerContext();
  const reason = text(formData, 'reason');
  await run((session) => rejectPayerRequest(session, ctx, text(formData, 'requestId'), reason === '' ? null : reason), '/payers?done=rejected');
}

export async function revokePayerAction(formData: FormData): Promise<void> {
  const { ctx } = await getServerContext();
  await run((session) => revokePayerLinkFrom('buyer', session, ctx, text(formData, 'linkId')), '/payers?done=revoked');
}

export async function revokePayeeAction(formData: FormData): Promise<void> {
  const { ctx } = await getServerContext();
  await run((session) => revokePayerLinkFrom('payer', session, ctx, text(formData, 'linkId')), '/payers?done=revoked');
}
