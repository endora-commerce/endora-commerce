// Feature 047 — helper that routes an email through the admin-editable
// transactional template when a sender is wired, returning false so the caller
// can fall back to its legacy in-code builder otherwise.
//
// Feature 072 (T120) moved this here from `organizations/services/
// org-template-email.ts`. It never was an organizations concern: every line of
// it is about the transactional sender and the channel an unscoped email
// resolves against. `organizations` owned it only because that module needed it
// first, and `inventory` reached it through a root that imported across the
// boundary and passed the result down — which stopped being expressible once
// both modules composed themselves.
//
// Emails that are not naturally sales-channel-scoped resolve against the
// system-default channel; global template editing still applies.

import type { TransactionalEmailSender } from '@endora-commerce/contracts';

export interface TemplateEmailDeps {
  getSender?: () => TransactionalEmailSender | undefined;
  resolveScopeSalesChannelId?: () => Promise<string | null>;
  resolveLanguage?: (salesChannelId: string) => Promise<string>;
}

export interface TemplateEmail {
  /**
   * `true` means "handled — do not use your legacy in-code builder". That
   * covers a delivered email, one an operator deactivated, and a composition
   * with no transport: in all three the platform decided what to send, and a
   * fallback would either send mail the operator switched off or fail the same
   * way. Only a code with no definition at all answers `false`.
   */
  trySend(input: {
    code: string;
    to: string;
    messageId: string;
    variables: Record<string, unknown>;
    meta?: Record<string, unknown> | undefined;
  }): Promise<boolean>;
}

export function makeTemplateEmail(deps: TemplateEmailDeps): TemplateEmail {
  return {
    async trySend(input): Promise<boolean> {
      const sender = deps.getSender?.();
      if (!sender) return false;
      const salesChannelId = (await deps.resolveScopeSalesChannelId?.()) ?? null;
      // **Not the seventh site of the `''`-sentinel family (issue #103) — do
      // not "fix" this line to pass `null` through.**
      //
      // `TransactionalEmailSendInput.salesChannelId` is `string | null` now, so
      // the compiler would let it. Two things make this branch different from
      // the six that were changed. It is a **producer**, and its `false` is not
      // silence: it means "caller, use your legacy in-code builder", so the
      // message still goes out — the other six turned an absent channel into a
      // failed settings read that a `catch` then reported as "not configured".
      // And the channel it wants is the **system-default** one, which D-47
      // establishes always exists, so this is a near-dead branch rather than a
      // wrong one.
      //
      // Passing `null` here would be a behaviour change for every module that
      // holds `templateEmailPort`: each would start sending the platform-wide
      // template where it sends its own builder's output today. That is a
      // product decision about what mail goes out, not a sentinel repair.
      if (!salesChannelId) return false;
      let language = 'en-US';
      if (deps.resolveLanguage) {
        try {
          language = await deps.resolveLanguage(salesChannelId);
        } catch {
          language = 'en-US';
        }
      }
      const outcome = await sender.send({
        code: input.code,
        salesChannelId,
        language,
        to: input.to,
        messageId: input.messageId,
        variables: input.variables,
        ...(input.meta ? { meta: input.meta } : {}),
      });
      return outcome.status !== 'no_definition';
    },
  };
}

/** No-op helper (sender not wired) — always falls back to the legacy builder. */
export const noopTemplateEmail: TemplateEmail = {
  async trySend(): Promise<boolean> {
    return false;
  },
};
