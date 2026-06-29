// Feature 047 — helper that routes an organizations email through the
// admin-editable transactional template when wired, returning false so the
// caller can fall back to its legacy in-code builder otherwise. Organizations
// emails are not naturally sales-channel-scoped, so they resolve against the
// system-default channel (global editing still applies).

import type { TransactionalEmailSender } from '@b2b/contracts';

export interface OrgTemplateEmailDeps {
  getSender?: () => TransactionalEmailSender | undefined;
  resolveScopeSalesChannelId?: () => Promise<string | null>;
  resolveLanguage?: (salesChannelId: string) => Promise<string>;
}

export interface OrgTemplateEmail {
  trySend(input: {
    code: string;
    to: string;
    messageId: string;
    variables: Record<string, unknown>;
    meta?: Record<string, unknown> | undefined;
  }): Promise<boolean>;
}

export function makeOrgTemplateEmail(deps: OrgTemplateEmailDeps): OrgTemplateEmail {
  return {
    async trySend(input): Promise<boolean> {
      const sender = deps.getSender?.();
      if (!sender) return false;
      const salesChannelId = (await deps.resolveScopeSalesChannelId?.()) ?? null;
      if (!salesChannelId) return false;
      let language = 'en-US';
      if (deps.resolveLanguage) {
        try {
          language = await deps.resolveLanguage(salesChannelId);
        } catch {
          language = 'en-US';
        }
      }
      await sender.send({
        code: input.code,
        salesChannelId,
        language,
        to: input.to,
        messageId: input.messageId,
        variables: input.variables,
        ...(input.meta ? { meta: input.meta } : {}),
      });
      return true;
    },
  };
}

/** No-op helper (sender not wired) — always falls back to the legacy builder. */
export const noopOrgTemplateEmail: OrgTemplateEmail = {
  async trySend(): Promise<boolean> {
    return false;
  },
};
