import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ANONYMIZED_EMAIL_RECIPIENT,
  type EmailDeliveryAnonymizationPort,
} from '@endora-commerce/contracts';
import type { AuditPort } from '@endora-commerce/platform/kernel';

/**
 * `email`'s step in the customer-account anonymisation sweep (issue #928),
 * registered as `emailDeliveryAnonymizationPort`; the contract is
 * {@link EmailDeliveryAnonymizationPort}'s.
 *
 * A delivery record (D-59) is written by the transport seam with the address a
 * message went to, its subject, the sender's `meta` envelope and, for a
 * refused message, the mail server's error text — which commonly quotes the
 * address. All four are about the person, so all four go. What stays is what
 * the record exists for: which message, of what kind, for which document, when,
 * and what became of it.
 *
 * Matched on the whole address, case-insensitively: the account's address is
 * stored case-folded, and a sender may have written it as typed. One statement
 * changes the rows and answers their ids, so a second sweep overlapping on the
 * same account waits on the row locks, then finds the address gone and changes
 * nothing; each record is therefore audited once. One `email_delivery.anonymized`
 * row per record, with a null actor and no payload (the #843 rule: the entry
 * says that data was erased, never what it was), in the same transaction as the
 * scrub. No event is published.
 *
 * Not reached: a record of an account anonymised before this step existed —
 * its address is gone from the account, so nothing names it any more.
 */
export class EmailDeliveryAnonymizationService implements EmailDeliveryAnonymizationPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog: AuditPort,
  ) {}

  async anonymizeForRecipient(recipient: string): Promise<number> {
    const address = recipient.trim().toLowerCase();
    // The marker is every anonymised record's recipient: asking for it would
    // re-scrub and re-audit them all.
    if (address === '' || address === ANONYMIZED_EMAIL_RECIPIENT) return 0;
    return this.emFactory().transactional(async (em) => {
      // command-coverage-ignore: the retention sweep's system-initiated scrub
      // of transport bookkeeping, audited below with the null actor that fact
      // deserves.
      const changed = (await em.execute(
        `update "email_deliveries"
            set "recipient" = ?, "subject" = null, "context" = null, "detail" = null, "updated_at" = now()
          where lower("recipient") = ?
          returning "id"`,
        [ANONYMIZED_EMAIL_RECIPIENT, address],
      )) as Array<{ id: string }>;
      for (const { id } of changed) {
        this.auditLog.recordWithin(em, {
          actorAdminUserId: null,
          action: 'email_delivery.anonymized',
          objectType: 'email_delivery',
          objectId: id,
          stateBefore: null,
          stateAfter: null,
        });
      }
      await em.flush();
      return changed.length;
    });
  }
}
