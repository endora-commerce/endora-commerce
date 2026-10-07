import {
  splitOpportunityReferenceText,
  formatOpportunityReferenceToken,
  type OpportunityReferenceType,
} from '@endora-commerce/contracts';

/**
 * What a person types to refer to something while writing (User Story 18,
 * FR-082): `@` and a person, `@@` and an Order, `@@@` and a Product.
 *
 * **This is the composer's and is never stored.** What is stored is the token
 * of `@endora-commerce/contracts` — the `@`s and the letters after them are
 * replaced by it the moment a result is chosen, and left exactly as typed when
 * none is.
 */

/** Longer than a full name or a document number; past it, it is a sentence. */
export const MENTION_QUERY_LIMIT = 40;

export interface MentionTrigger {
  /** What the run asks for — one `@` a person, two an Order, three a Product. */
  kind: OpportunityReferenceType;
  /** Where the first `@` is, and where the caret is: the stretch a choice replaces. */
  start: number;
  end: number;
  /** What was typed after the `@`s. */
  query: string;
}

const KIND_BY_LENGTH: readonly OpportunityReferenceType[] = ['admin_user', 'order', 'product'];

/**
 * The run of `@`s the caret is typing after, or `null`.
 *
 * A run opens only at the start of the text or after white space, so the `@`
 * of an e-mail address opens nothing; it holds one to three `@`s, so a fourth
 * closes it; what follows must not begin with a space, so `@ ` is the
 * character it is; and it stays on one line. The expression is anchored at the
 * caret and has one bounded quantifier, so it is linear in the text.
 */
const TRIGGER = new RegExp(`(?:^|\\s)(@{1,3})((?:[^\\s@][^\\n@]{0,${MENTION_QUERY_LIMIT - 1}})?)$`);

export function findMentionTrigger(text: string, caret: number): MentionTrigger | null {
  const before = text.slice(0, caret);
  const match = TRIGGER.exec(before);
  if (!match) return null;
  const marks = match[1] ?? '';
  const query = match[2] ?? '';
  const start = before.length - query.length - marks.length;
  const kind = KIND_BY_LENGTH[marks.length - 1];
  return kind ? { kind, start, end: caret, query } : null;
}

/**
 * `text` with the stretch of `trigger` replaced by the token of what was
 * chosen, and where the caret goes afterwards. A space follows the token
 * unless one already does, so the sentence is simply carried on.
 */
export function applyMention(
  text: string,
  trigger: Pick<MentionTrigger, 'kind' | 'start' | 'end'>,
  id: string,
): { text: string; caret: number } {
  const token = formatOpportunityReferenceToken(trigger.kind, id);
  const rest = text.slice(trigger.end);
  const gap = /^\s/.test(rest) ? '' : ' ';
  return {
    text: `${text.slice(0, trigger.start)}${token}${gap}${rest}`,
    caret: trigger.start + token.length + 1,
  };
}

/**
 * A long text cut for a place that shows only its beginning — the Change
 * history — **without ever cutting a token in two**: half a token would be
 * shown as the code it is. A token counts as one character, since it is read
 * as a name.
 */
export function clipReferenceText(text: string, limit: number): string {
  let room = limit;
  let clipped = '';
  for (const part of splitOpportunityReferenceText(text)) {
    if (part.kind === 'reference') {
      if (room < 1) return `${clipped}…`;
      clipped += formatOpportunityReferenceToken(part.type, part.id);
      room -= 1;
      continue;
    }
    if (part.text.length > room) return `${clipped}${part.text.slice(0, room)}…`;
    clipped += part.text;
    room -= part.text.length;
  }
  return clipped;
}
