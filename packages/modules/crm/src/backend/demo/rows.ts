/**
 * The tags CRM's demo data creates
 * (`specs/143-crm-sales-opportunities/research.md` N-DD1).
 *
 * One place holding the data, imported by both bodies: `seed.ts` creates these
 * rows and `reset.ts` withdraws exactly them, by the `name` they are keyed on —
 * the column the table declares unique, case-insensitively.
 *
 * ## What is not here
 *
 * The demo **pipeline**. An Opportunity is this module's row carrying an
 * Organization, an assignee, a contact person and a Sales Channel, each another
 * module's or the kernel's; so the Opportunities, their status history, their
 * notes and which of these tags each one carries are a step of the instance's
 * demo composition (`@endora-commerce/demo-composition`), which runs after
 * every module's `seed` and finds these tags waiting. A tag is the one row of
 * this module that names nobody else's.
 *
 * A tag's name is operator content with one spelling, as a status's code is:
 * `crm_tags.name` is a single `varchar(64)`, with nowhere to hold a variant per
 * language.
 */

/** One demo tag, in `CrmTag`'s own field names. */
export interface DemoTagRow {
  readonly name: string;
  /** Badge colour as a `#rrggbb` hex value. */
  readonly color: string;
}

export const DEMO_TAGS: readonly DemoTagRow[] = [
  { name: 'Key account', color: '#2563eb' },
  { name: 'Upsell', color: '#16a34a' },
  { name: 'Tender', color: '#d97706' },
];

/** The names `reset` withdraws — derived from the rows, never a second list. */
export const DEMO_TAG_NAMES: readonly string[] = DEMO_TAGS.map((row) => row.name);
