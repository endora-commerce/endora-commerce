/**
 * OrganizationConfirmationEmailsPort — feature 038 (US4 / R6).
 *
 * Cross-module read of the per-organization additional order-confirmation
 * emails. The `organizations` module owns the `order_confirmation_emails`
 * column; the orders module reads it only through this interface so the modules
 * stay isolated (Constitution Principle I).
 */
export interface OrganizationConfirmationEmailsPort {
  getConfirmationEmails(organizationId: string): Promise<string[]>;
}
