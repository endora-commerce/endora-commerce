import { simpleEmailBodyTree } from '@endora-commerce/email-components/defaults/simple-email-body';

/**
 * The default subject and body of the Event reminder e-mail
 * (`specs/143-crm-sales-opportunities/contracts/events-and-ports.md` §5a),
 * in the two languages an Admin UI is drawn in. An operator edits either, per
 * language, on the e-mail templates screen — or switches the e-mail off, which
 * costs nobody their bell entry.
 *
 * The same facts as the bell entry and no more: the Event's name, when it
 * starts, and the Opportunity's number — never the Event's description and
 * never the Opportunity's title (research N-CAL7).
 *
 * **The link is a button, and only when there is an address.** A link in an
 * e-mail has to be absolute, so it is built on the platform's `ADMIN_BASE_URL`
 * (`configuredAdminBaseUrl`, issue #185): `event.adminUrl` opens the Opportunity
 * on its Events tab with this Event marked — the bell entry's address. Where
 * the admin's address is not configured the variable is not sent and the
 * button is dropped (`@endora-commerce/email-components` drops a button whose
 * address is one empty variable), so the body still says which Opportunity by
 * its number, as the bell entry does. An operator's own template that does not
 * name the variable renders as before.
 */

export const EVENT_REMINDER_EMAIL_CODE = 'crm_event_reminder';

export const EVENT_REMINDER_DEFAULT = {
  defaultSubject: {
    'en-US': 'Reminder: {{var event.name}} — {{var event.when}}',
    'pl-PL': 'Przypomnienie: {{var event.name}} — {{var event.when}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'crm-event-reminder',
        heading: 'Event reminder',
        text: [
          '{{var event.name}}',
          'When: {{var event.when}}',
          'Sales opportunity: {{var opportunity.number}}',
          'Open the opportunity in the admin panel to see the event.',
        ].join('\n'),
        ctaLabel: 'Open the event',
        ctaHref: '{{var event.adminUrl}}',
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'crm-event-reminder',
        heading: 'Przypomnienie o wydarzeniu',
        text: [
          '{{var event.name}}',
          'Kiedy: {{var event.when}}',
          'Szansa sprzedażowa: {{var opportunity.number}}',
          'Otwórz szansę sprzedażową w panelu administracyjnym, aby zobaczyć wydarzenie.',
        ].join('\n'),
        ctaLabel: 'Otwórz wydarzenie',
        ctaHref: '{{var event.adminUrl}}',
      }),
    },
  },
};
