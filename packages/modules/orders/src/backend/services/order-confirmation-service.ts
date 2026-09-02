import type { OrganizationConfirmationEmailsPort } from '../../ports/organization-confirmation-emails.port.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * OrderConfirmationService — feature 038 (US4).
 *
 * Resolves the *additional* order-confirmation recipients for an order: the
 * customer's Organization list (per-org config) plus the Settings-scoped list
 * (global / sales-channel). Invalid or empty entries are dropped, never fatal
 * (FR-015). The customer's own email is added by the caller.
 */
export class OrderConfirmationService {
  constructor(
    private readonly orgPort: OrganizationConfirmationEmailsPort,
    private readonly resolveScopeRecipients?: (salesChannelId: string) => Promise<string[]>,
  ) {}

  /** Deduped, syntactically valid additional recipients for the order's scope. */
  async resolveAdditional(organizationId: string, salesChannelId: string): Promise<string[]> {
    const [orgEmails, scopeEmails] = await Promise.all([
      this.orgPort.getConfirmationEmails(organizationId).catch(() => [] as string[]),
      this.resolveScopeRecipients ? this.resolveScopeRecipients(salesChannelId).catch(() => []) : Promise.resolve([]),
    ]);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of [...orgEmails, ...scopeEmails]) {
      const email = (raw ?? '').trim();
      if (!EMAIL_RE.test(email)) continue; // invalid recipients are skipped, not fatal
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(email);
    }
    return out;
  }
}
