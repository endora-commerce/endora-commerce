import type {
  CustomerAccountReadPort,
  CustomerAccountRecord,
  OrganizationDetailsPort,
  TransactionalEmailSender,
} from '@endora-commerce/contracts';
import { ModuleDisabledError, rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import type { Cart } from '../entities/cart.entity.js';
import {
  CART_APPROVAL_REQUESTED_EMAIL_CODE,
  CART_APPROVED_EMAIL_CODE,
  CART_REJECTED_EMAIL_CODE,
} from '../email-templates/cart-approval-defaults.js';
import type { CartEmailDispatch } from './cart-approval-service.js';

export {
  CART_APPROVAL_REQUESTED_EMAIL_CODE,
  CART_APPROVED_EMAIL_CODE,
  CART_REJECTED_EMAIL_CODE,
} from '../email-templates/cart-approval-defaults.js';

/**
 * Why a cart-approval e-mail did not go out. Every one is written to the log
 * and costs nothing else: the approval transition it announces has already
 * been flushed when the dispatch is called, and stands.
 */
export type CartApprovalEmailNotSentReason =
  /** No transactional sender is wired in this composition. */
  | 'no_sender'
  /** No address resolves: the buyer is gone, or the Organization has no administrator to tell. */
  | 'no_recipient'
  /** The operator switched this e-mail off on the templates screen. */
  | 'deactivated'
  /** No mailer is wired behind the sender. */
  | 'no_transport'
  /** No definition exists for this code yet. */
  | 'no_definition'
  /** No mail server is configured: the message was only written to the log (issue #186). */
  | 'logged'
  /** A module this e-mail reads through is switched off. */
  | 'module_disabled'
  /** The send raised. */
  | 'failed';

export type CartApprovalEmailLog = (message: string, context: Record<string, unknown>) => void;

export interface CartApprovalEmailDeps {
  /**
   * `transactional_emails`' late-bound sender, read per send: it answers
   * `undefined` until that module has announced it.
   */
  sender: () => TransactionalEmailSender | undefined;
  /** `customer_accounts`' read port — the buyer, the actor and the Organization's administrators. */
  customerAccounts: Pick<CustomerAccountReadPort, 'findById' | 'listByOrganization'>;
  /** `organizations`' read port — the Organization's name. */
  organizations: Pick<OrganizationDetailsPort, 'findById'>;
  /** The default language of a store (sales channel), `null` when it does not resolve. */
  channelLanguage: (salesChannelId: string) => Promise<string | null>;
  /** Where a send that did not happen is reported. */
  log: CartApprovalEmailLog;
}

/**
 * Who is told a cart waits for approval: the Organization's administrators —
 * active, not blocked, not anonymised — and never the buyer who submitted it,
 * even should they hold the role (an administrator's own cart is never sent
 * for approval, so this is a guard, not a rule that bites).
 */
export async function organizationAdminRecipients(
  accounts: Pick<CustomerAccountReadPort, 'listByOrganization'>,
  organizationId: string,
  submitterId: string,
): Promise<CustomerAccountRecord[]> {
  const members = await accounts.listByOrganization(organizationId, { activeOnly: true });
  return members.filter(
    (member) =>
      member.role === 'organization_admin' &&
      member.id !== submitterId &&
      member.blockedAt === null &&
      member.anonymizedAt === null &&
      member.email !== '',
  );
}

/**
 * The language an approval e-mail is written in.
 *
 * A customer account records no language preference, so the one the platform
 * knows for its reader is the language of the store the cart belongs to —
 * where the buyer shops and where the administrator approves — as `orders`,
 * `returns` and `organizations`' invitation do. `en-US` when the store has
 * none, which is what the sender falls back to as well.
 */
export function approvalEmailLanguage(channelLanguage: string | null): string {
  return channelLanguage ? channelLanguage : 'en-US';
}

function displayName(account: CustomerAccountRecord | null): string {
  if (!account) return '';
  return [account.firstName, account.lastName].filter(Boolean).join(' ').trim() || account.email;
}

/**
 * The cart-approval e-mails (issue #651), as the {@link CartEmailDispatch}
 * `CartApprovalService` calls after each transition has been flushed:
 *
 * - **submitted** → every administrator of the buyer's Organization, one
 *   message each;
 * - **approved** → the buyer, naming who approved it;
 * - **rejected** → the buyer, with the reason.
 *
 * **Fire-and-forget, and audible.** A message that does not go out is named in
 * the log and never raised — one administrator's mail server refusing does not
 * stop the next administrator being told. The one thing it does not contain is
 * a module switched off, which is a presence answer about the capability and
 * not a failed message (`rethrowIfModuleDisabled`, issue #84): it is logged and
 * travels on, and `CartApprovalService.dispatch` absorbs it after the write.
 */
export function createCartApprovalEmailDispatch(deps: CartApprovalEmailDeps): CartEmailDispatch {
  const notSent = (
    context: { cartId: string; code: string; recipientId?: string },
    reason: CartApprovalEmailNotSentReason,
    error?: unknown,
  ): void => {
    deps.log('[carts] the cart approval e-mail was not sent', {
      ...context,
      reason,
      ...(error === undefined ? {} : { error: error instanceof Error ? error.message : String(error) }),
    });
  };

  /** The facts every message names: the store's language and the Organization. */
  const scope = async (cart: Cart): Promise<{ language: string; organizationName: string }> => {
    const [language, organization] = await Promise.all([
      cart.salesChannelId ? deps.channelLanguage(cart.salesChannelId) : Promise.resolve(null),
      cart.organizationId ? deps.organizations.findById(cart.organizationId) : Promise.resolve(null),
    ]);
    return { language: approvalEmailLanguage(language), organizationName: organization?.name ?? '' };
  };

  const send = async (
    cart: Cart,
    code: string,
    recipient: CustomerAccountRecord,
    input: { language: string; messageId: string; variables: Record<string, unknown> },
  ): Promise<void> => {
    const context = { cartId: cart.id, code, recipientId: recipient.id };
    const sender = deps.sender();
    if (!sender) return notSent(context, 'no_sender');
    try {
      const outcome = await sender.send({
        code,
        salesChannelId: cart.salesChannelId ?? null,
        language: input.language,
        to: recipient.email,
        messageId: input.messageId,
        variables: input.variables,
        meta: { kind: code, cartId: cart.id },
      });
      if (outcome.status !== 'sent') notSent(context, outcome.status);
    } catch (error) {
      if (error instanceof ModuleDisabledError) notSent(context, 'module_disabled', error);
      rethrowIfModuleDisabled(error);
      // Everything else is contained, and named: the transition is flushed and
      // must not be reported as failed because a mail server is away.
      notSent(context, 'failed', error);
    }
  };

  /** Resolution before any send — logged here, raised on for the service to absorb. */
  const resolving = async <T>(context: { cartId: string; code: string }, read: () => Promise<T>): Promise<T> => {
    try {
      return await read();
    } catch (error) {
      notSent(context, error instanceof ModuleDisabledError ? 'module_disabled' : 'failed', error);
      throw error;
    }
  };

  const toBuyer = async (
    cart: Cart,
    code: string,
    actorId: string,
    at: Date | null | undefined,
    variables: (actorName: string) => Record<string, unknown>,
  ): Promise<void> => {
    const context = { cartId: cart.id, code };
    const { buyer, actor, language, organizationName } = await resolving(context, async () => {
      const [buyerRecord, actorRecord, facts] = await Promise.all([
        cart.customerAccountId ? deps.customerAccounts.findById(cart.customerAccountId) : Promise.resolve(null),
        deps.customerAccounts.findById(actorId),
        scope(cart),
      ]);
      return { buyer: buyerRecord, actor: actorRecord, ...facts };
    });
    if (!buyer || buyer.deletedAt !== null || buyer.anonymizedAt !== null || !buyer.email) {
      return notSent(context, 'no_recipient');
    }
    await send(cart, code, buyer, {
      language,
      messageId: `${code}:${cart.id}:${(at ?? new Date()).getTime()}`,
      variables: {
        ...variables(displayName(actor)),
        buyer: { name: displayName(buyer), email: buyer.email },
        organization: { name: organizationName },
        cart: { id: cart.id },
      },
    });
  };

  return {
    async onSubmittedForApproval({ cart, submitter }): Promise<void> {
      const code = CART_APPROVAL_REQUESTED_EMAIL_CODE;
      const context = { cartId: cart.id, code };
      const { buyer, admins, language, organizationName } = await resolving(context, async () => {
        const [buyerRecord, adminRecords, facts] = await Promise.all([
          deps.customerAccounts.findById(submitter.customerAccountId),
          organizationAdminRecipients(deps.customerAccounts, submitter.organizationId, submitter.customerAccountId),
          scope(cart),
        ]);
        return { buyer: buyerRecord, admins: adminRecords, ...facts };
      });
      if (admins.length === 0) return notSent(context, 'no_recipient');
      const submittedAt = (cart.submittedForApprovalAt ?? new Date()).getTime();
      for (const admin of admins) {
        // One message per administrator and per submission: a cart re-armed and
        // sent again is a new message, a retry of the same one is not.
        await send(cart, code, admin, {
          language,
          messageId: `${code}:${cart.id}:${submittedAt}:${admin.id}`,
          variables: {
            buyer: { name: displayName(buyer), email: buyer?.email ?? '' },
            organization: { name: organizationName },
            cart: { id: cart.id },
          },
        });
      }
    },

    async onApproved({ cart, approver }): Promise<void> {
      await toBuyer(cart, CART_APPROVED_EMAIL_CODE, approver.customerAccountId, cart.approvedAt, (name) => ({
        approver: { name },
      }));
    },

    async onRejected({ cart, rejector, reason }): Promise<void> {
      await toBuyer(cart, CART_REJECTED_EMAIL_CODE, rejector.customerAccountId, cart.rejectedAt, (name) => ({
        rejector: { name },
        reason,
      }));
    },
  };
}
