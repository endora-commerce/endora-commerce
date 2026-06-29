import type { EntityManager } from '@mikro-orm/postgresql';
import { Organization } from '../entities/organization.entity.js';
import type { AdminNotificationService } from '../../admin_notifications/services/admin-notification-service.js';
import type { Mailer } from '../../email/services/mailer.js';
import { noopOrgTemplateEmail, type OrgTemplateEmail } from './org-template-email.js';

/**
 * OrgRegistrationNotifier — subscribes to `organization.registered.v1` and
 * dispatches two side effects:
 *
 *  1. Writes one `admin_notifications` row (audience='all_admins',
 *     kind='organization.registered') so the admin bell + feed pick it up.
 *  2. Reads the `organizations.notifications.new_registration_recipients`
 *     setting (a list of e-mail addresses) and sends one notification e-mail
 *     per recipient. Empty / unset list ⇒ no e-mails (the admin bell still
 *     fires).
 *
 * The notifier is best-effort by design — a downstream failure never
 * poisons the registration itself, which has already committed before the
 * event was emitted.
 */
export interface OrgRegistrationNotifierDeps {
  emFactory: () => EntityManager;
  adminNotificationService: AdminNotificationService;
  mailer: Mailer;
  resolveRecipients: () => Promise<string[]>;
  onError?: (err: unknown) => void;
  /** Feature 047 — optional admin-editable template path. */
  templateEmail?: OrgTemplateEmail;
}

export class OrgRegistrationNotifier {
  constructor(private readonly deps: OrgRegistrationNotifierDeps) {}

  async handleRegistered(organizationId: string): Promise<void> {
    try {
      const em = this.deps.emFactory();
      const org = await em.findOne(Organization, { id: organizationId, deletedAt: null });
      if (!org) return;

      await this.writeAdminNotification(org);
      await this.dispatchRecipientEmails(org);
    } catch (err) {
      this.deps.onError?.(err);
    }
  }

  private async writeAdminNotification(org: Organization): Promise<void> {
    await this.deps.adminNotificationService.record({
      audience: 'all_admins',
      kind: 'organization.registered',
      subjectType: 'organization',
      subjectId: org.id,
      title: `Nowa Organizacja: ${org.name}`,
      body:
        org.status === 'pending_verification'
          ? 'Oczekuje na weryfikację.'
          : 'Zarejestrowana automatycznie.',
      linkPath: `/organizations/${org.id}`,
    });
  }

  private async dispatchRecipientEmails(org: Organization): Promise<void> {
    let recipients: string[] = [];
    try {
      recipients = await this.deps.resolveRecipients();
    } catch {
      // Setting unreachable — degrade to "no email recipients".
    }
    if (recipients.length === 0) return;
    const template = this.deps.templateEmail ?? noopOrgTemplateEmail;
    const statusLabel =
      org.status === 'pending_verification' ? 'Oczekuje na weryfikację' : 'Aktywna';
    for (const to of recipients) {
      const messageId = `organization.registered.${org.id}.${to.toLowerCase()}`;
      try {
        const sentViaTemplate = await template.trySend({
          code: 'new_org_registration',
          to,
          messageId,
          variables: {
            organizationName: org.name,
            taxId: org.taxId,
            statusLabel,
            linkPath: `/organizations/${org.id}`,
          },
          meta: { organizationId: org.id, kind: 'organization.registered' },
        });
        if (!sentViaTemplate) {
          await this.deps.mailer.send({
            messageId,
            to,
            subject: `Nowa Organizacja: ${org.name}`,
            text: this.composeBody(org),
            meta: { organizationId: org.id, kind: 'organization.registered' },
          });
        }
      } catch (err) {
        this.deps.onError?.(err);
      }
    }
  }

  private composeBody(org: Organization): string {
    return [
      `Zarejestrowała się nowa Organizacja na platformie B2B.`,
      ``,
      `  Nazwa:   ${org.name}`,
      `  NIP/VAT: ${org.taxId}`,
      `  Status:  ${org.status === 'pending_verification' ? 'Oczekuje na weryfikację' : 'Aktywna'}`,
      ``,
      `Otwórz w Panelu Administracyjnym: /organizations/${org.id}`,
    ].join('\n');
  }
}
