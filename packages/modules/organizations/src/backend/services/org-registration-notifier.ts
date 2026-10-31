import type { EntityManager } from '@mikro-orm/postgresql';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { Organization } from '../entities/organization.entity.js';
import {
  LANGUAGE_FALLBACK,
  type AdminNotificationRecordPort,
  type EmailMailerPort,
  type SupportedLanguage,
} from '@endora-commerce/contracts';
import { noopOrgTemplateEmail, type OrgTemplateEmail } from './org-template-email.js';
import { organizationsProse, type OrganizationsTranslate } from './organizations-prose.js';

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
 * The bell entry is read by many administrators, each in a language of their
 * own, so it carries English sentences and the keys their readers translate.
 * The e-mail goes to addresses whose readers' language nobody recorded, so it
 * is written in the deployment's language — `resolveLanguage`, the language
 * the template path sends in as well — from this module's bundle (issue #94).
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
  /** This module's bundle. Absent, the e-mail is composed in English. */
  translate?: OrganizationsTranslate;
  /** The language the e-mail is written in. Absent, `LANGUAGE_FALLBACK`. */
  resolveLanguage?: () => Promise<SupportedLanguage>;
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
    const titleParams = { name: org.name };
    const bodyKey =
      org.status === 'pending_verification'
        ? 'notifications.newRegistration.body.pending'
        : 'notifications.newRegistration.body.active';
    await this.deps.adminNotificationService.record({
      audience: 'all_admins',
      kind: 'organization.registered',
      subjectType: 'organization',
      subjectId: org.id,
      title: await organizationsProse(
        undefined,
        'notifications.newRegistration.title',
        LANGUAGE_FALLBACK,
        titleParams,
      ),
      body: await organizationsProse(undefined, bodyKey, LANGUAGE_FALLBACK),
      titleMessage: {
        scope: 'organizations',
        key: 'notifications.newRegistration.title',
        params: titleParams,
      },
      bodyMessage: { scope: 'organizations', key: bodyKey },
      linkPath: `/organizations/${org.id}`,
    });
  }

  private async language(): Promise<SupportedLanguage> {
    if (!this.deps.resolveLanguage) return LANGUAGE_FALLBACK;
    try {
      return await this.deps.resolveLanguage();
    } catch {
      return LANGUAGE_FALLBACK;
    }
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
    const language = await this.language();
    const statusLabel = await organizationsProse(
      this.deps.translate,
      org.status === 'pending_verification'
        ? 'notifications.newRegistration.status.pending'
        : 'notifications.newRegistration.status.active',
      language,
    );
    const subject = await organizationsProse(
      this.deps.translate,
      'notifications.newRegistration.title',
      language,
      { name: org.name },
    );
    const text = await organizationsProse(
      this.deps.translate,
      'notifications.newRegistration.email.body',
      language,
      { name: org.name, taxId: org.taxId, status: statusLabel, linkPath: `/organizations/${org.id}` },
    );
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
            subject,
            text,
            meta: { organizationId: org.id, kind: 'organization.registered' },
          });
          // Only the transport's refusal is named here. `logged` (issue #186) is the
          // console driver saying no mail server is configured: it has already
          // written the message to the log itself, and the delivery record says so.
          if (outcome.status === 'suppressed') {
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
}
