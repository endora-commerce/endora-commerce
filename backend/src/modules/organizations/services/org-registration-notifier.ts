import type { EntityManager } from '@mikro-orm/postgresql';
import { rethrowIfModuleDisabled } from '../../../kernel/lifecycle/plugin-helpers.js';
import { Organization } from '../entities/organization.entity.js';
import type { AdminNotificationRecordPort, EmailMailerPort } from '@endora-commerce/contracts';
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
  adminNotificationService: AdminNotificationRecordPort;
  mailer: EmailMailerPort;
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
      // `writeAdminNotification` reaches `admin_notifications` through a gated
      // port, and that module declares no `activation.nonDeactivatable`: switch
      // it off and every organization registration went silently un-notified,
      // with `onError` absorbing the 503 (D-88). A registration nobody was told
      // about is not a degrade `organizations` may choose on
      // `admin_notifications`' behalf — if that module is off, the answer
      // belongs in its own port's return type, decided by its owner. The rest
      // of the tolerance stays: the registration itself has already committed,
      // so an ordinary downstream failure must not poison it.
      rethrowIfModuleDisabled(err);
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
          const outcome = await this.deps.mailer.send({
            messageId,
            to,
            subject: `Nowa Organizacja: ${org.name}`,
            text: this.composeBody(org),
            meta: { organizationId: org.id, kind: 'organization.registered' },
          });
          if (outcome.status !== 'sent') {
            // `onError` is for a throw; a suppression is not one. Each
            // recipient is independent, so it is named on its own — and D-59's
            // record holds the same fact per recipient.
            console.warn('[organizations] the new-organization e-mail was not sent', {
              organizationId: org.id,
              to,
              reason: outcome.reason,
            });
          }
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
