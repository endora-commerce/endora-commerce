/**
 * The effective value of an Opportunity — the one statement of the rule
 * (`data-model.md` § `crm_opportunities`).
 *
 * An Opportunity carries two figures and a mode: `manual_value`, which a
 * person types in, and `computed_value`, which the value service maintains
 * from the linked Orders and Quote Requests. Whichever the mode names is what
 * the Opportunity is worth — on the detail, in the list's `sort=value`, in the
 * board's column totals and in every analytics figure.
 *
 * Both forms live here so they cannot drift apart: the list, the board and the
 * analytics each used to hold a private copy of the SQL (research N-F2 (f)),
 * which is how three screens come to disagree about one computed Opportunity.
 * `effective-value.test.ts` holds that no other file spells the rule out.
 */
export type OpportunityValueFigures = {
  valueMode: 'manual' | 'computed';
  manualValue?: string | null;
  computedValue: string;
};

/** The rule over a loaded row: the manual figure or the computed one, by mode. */
export function effectiveOpportunityValue(opportunity: OpportunityValueFigures): string | null {
  return opportunity.valueMode === 'manual' ? (opportunity.manualValue ?? null) : opportunity.computedValue;
}

/**
 * An alias is a table alias a caller wrote, or the placeholder the ORM hands a
 * `raw((alias) => …)` callback and substitutes itself (`[::alias::]`). Neither
 * carries a quote, a semicolon or white space.
 */
const SQL_ALIAS = /^[^\s"';]+$/;

/**
 * The same rule as a SQL expression over `crm_opportunities <alias>`.
 *
 * `null` for a manual Opportunity nobody has valued, so `sum` skips it and a
 * caller that wants valued rows only writes `… is not null`. The alias is
 * spliced into a statement, so one that could end the identifier is refused.
 */
export function effectiveOpportunityValueSql(alias: string): string {
  if (!SQL_ALIAS.test(alias)) throw new Error(`effectiveOpportunityValueSql: "${alias}" is not a table alias.`);
  return `case when ${alias}."value_mode" = 'manual' then ${alias}."manual_value" else ${alias}."computed_value" end`;
}
