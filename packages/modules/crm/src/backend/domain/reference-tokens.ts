import {
  extractOpportunityReferenceTokens,
  type OpportunityReferenceToken,
} from '@endora-commerce/contracts';

/**
 * The Products and Orders a free text mentions — `[[product:<uuid>]]`,
 * `[[order:<uuid>]]` — in first-appearance order, each target once
 * (`specs/143-crm-sales-opportunities/research.md` R-21).
 *
 * **The grammar is written once, in the contracts package**, because the Admin
 * UI's composer inserts with it and its renderer splits on it; this is the
 * backend's door to it, which also answers for a text that is not there. A
 * malformed token is not an error: it is text, and stays text.
 *
 * The expression behind it has no nested quantifier and no alternation that
 * can match the same characters two ways, so it is linear in the text however
 * hostile the text is; `reference-tokens.test.ts` holds that.
 */
export function referenceTokensOf(text: string | null | undefined): OpportunityReferenceToken[] {
  return text ? extractOpportunityReferenceTokens(text) : [];
}
