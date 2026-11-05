import { UUID_SHAPE_PATTERN } from './common.js';
import { recordReferenceTypeSchema, type RecordReferenceType } from './record-references.js';

/**
 * The formatted-text grammar of a record's free text — an Opportunity's or a
 * Project's description, a note's or a message's body, a Task's description
 * (`specs/158-crm-opportunity-inline-editing/` research R-2; moved here from
 * `crm-rich-text.ts` under neutral names by `specs/163-projects-and-tasks/`
 * research R-14, which `crm-rich-text.ts` re-exports under its own names).
 *
 * **What is stored is still a string**, carrying the `[[type:id]]` reference
 * tokens it always carried, with a small Markdown subset on top:
 *
 * | Written            | Read as                                  |
 * | ------------------ | ---------------------------------------- |
 * | `**text**`         | bold                                     |
 * | `_text_`           | italic — not inside a word (`ABC_1_X`)   |
 * | `~~text~~`         | strikethrough                            |
 * | `[label](https://…)` | a link — `http`, `https`, `mailto` only |
 * | `- item`           | a bulleted list's item                   |
 * | `3. item`          | a numbered list's item                   |
 * | `\*`, `\_`, …      | the character itself                     |
 *
 * Every line is a block. Text written before formatting existed reads as the
 * paragraphs it was, so nothing stored needs migrating; the token grammar, the
 * length limits, mention extraction and search are untouched; and an e-mail or
 * a bell entry that shows the text plainly shows it readably
 * (`recordRichTextToPlain`).
 *
 * **Nothing here is HTML.** A screen draws the blocks as elements of its own,
 * every stretch of text as a text node, so there is no markup to sanitise.
 */

export type RecordRichMark = 'bold' | 'italic' | 'strike';

/** The order marks are written in, outermost first — what makes the writer deterministic. */
const MARK_ORDER: readonly RecordRichMark[] = ['bold', 'italic', 'strike'];
const MARK_DELIMITER: Record<RecordRichMark, string> = { bold: '**', italic: '_', strike: '~~' };

export type RecordRichInline =
  | { kind: 'text'; text: string; marks: RecordRichMark[]; href?: string }
  | { kind: 'reference'; type: RecordReferenceType; id: string; marks: RecordRichMark[] };

export type RecordRichBlock =
  | { kind: 'paragraph'; content: RecordRichInline[] }
  | { kind: 'bullet_list'; items: RecordRichInline[][] }
  | { kind: 'ordered_list'; start: number; items: RecordRichInline[][] };

/** Characters a backslash makes literal. */
const ESCAPABLE = new Set(['\\', '*', '_', '~', '[', ']']);
const SAFE_HREF = /^(https?:\/\/[^\s()<>]+|mailto:[^\s()<>]+)$/i;
const REFERENCE_AT = new RegExp(
  `\\[\\[(${recordReferenceTypeSchema.options.join('|')}):(${UUID_SHAPE_PATTERN})\\]\\]`,
  'y',
);
const BULLET_LINE = /^- (.*)$/s;
const ORDERED_LINE = /^(\d{1,9})\. (.*)$/s;
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/** Whether `href` may be a link's address. */
export function isSafeRecordRichHref(href: string): boolean {
  return SAFE_HREF.test(href);
}

// --- Reading ---------------------------------------------------------------------

interface Cursor {
  source: string;
  at: number;
  /**
   * The openers already known to have no closer on this line. A later opener
   * of the same kind is read as characters without scanning again — what keeps
   * a line of ten thousand unclosed `~~` linear.
   */
  exhausted: Set<RecordRichMark | 'link'>;
}

function isWord(character: string | undefined): boolean {
  return character !== undefined && WORD_CHARACTER.test(character);
}

/** Whether the delimiter at the cursor may close `mark`. */
function closesHere(cursor: Cursor, mark: RecordRichMark): boolean {
  const delimiter = MARK_DELIMITER[mark];
  if (!cursor.source.startsWith(delimiter, cursor.at)) return false;
  if (mark === 'italic') return !isWord(cursor.source[cursor.at + 1]);
  return true;
}

/** Whether the delimiter at the cursor may open `mark`. */
function opensHere(cursor: Cursor, mark: RecordRichMark): boolean {
  const delimiter = MARK_DELIMITER[mark];
  if (!cursor.source.startsWith(delimiter, cursor.at)) return false;
  const next = cursor.source[cursor.at + delimiter.length];
  if (next === undefined) return false;
  if (mark === 'italic') return !isWord(cursor.source[cursor.at - 1]) && next !== ' ';
  return true;
}

type Until = { mark: RecordRichMark } | { linkLabel: true } | null;

/**
 * Inline content from the cursor up to `until` — a mark's closing delimiter, a
 * link label's `]` — or to the end. Returns `null` when `until` is never met:
 * the opener is then plain characters.
 */
function readInline(
  cursor: Cursor,
  marks: RecordRichMark[],
  href: string | undefined,
  until: Until,
): RecordRichInline[] | null {
  const out: RecordRichInline[] = [];
  const pushText = (value: string): void => {
    const last = out[out.length - 1];
    if (last && last.kind === 'text' && sameMarks(last.marks, marks) && last.href === href) {
      last.text += value;
      return;
    }
    out.push({ kind: 'text', text: value, marks: [...marks], ...(href ? { href } : {}) });
  };

  while (cursor.at < cursor.source.length) {
    if (until && 'mark' in until && closesHere(cursor, until.mark)) {
      cursor.at += MARK_DELIMITER[until.mark].length;
      return out;
    }
    if (until && 'linkLabel' in until && cursor.source[cursor.at] === ']') {
      cursor.at += 1;
      return out;
    }
    const character = cursor.source[cursor.at] as string;

    if (character === '\\' && ESCAPABLE.has(cursor.source[cursor.at + 1] ?? '')) {
      pushText(cursor.source[cursor.at + 1] as string);
      cursor.at += 2;
      continue;
    }

    REFERENCE_AT.lastIndex = cursor.at;
    const reference = REFERENCE_AT.exec(cursor.source);
    if (reference) {
      out.push({
        kind: 'reference',
        type: reference[1] as RecordReferenceType,
        id: (reference[2] as string).toLowerCase(),
        marks: [...marks],
      });
      cursor.at += reference[0].length;
      continue;
    }

    if (character === '[' && href === undefined && !cursor.exhausted.has('link')) {
      const link = tryLink(cursor, marks);
      if (link) {
        out.push(...link);
        continue;
      }
    }

    const opened = MARK_ORDER.find(
      (mark) => !marks.includes(mark) && !cursor.exhausted.has(mark) && opensHere(cursor, mark),
    );
    if (opened) {
      const start = cursor.at;
      cursor.at += MARK_DELIMITER[opened].length;
      const inner = readInline(cursor, [...marks, opened].sort(byMarkOrder), href, { mark: opened });
      if (inner) {
        for (const node of inner) {
          if (node.kind === 'text') pushTextNode(out, node);
          else out.push(node);
        }
        continue;
      }
      cursor.at = start;
      cursor.exhausted.add(opened);
      pushText(MARK_DELIMITER[opened]);
      cursor.at += MARK_DELIMITER[opened].length;
      continue;
    }

    pushText(character);
    cursor.at += 1;
  }
  return until ? null : out;
}

function pushTextNode(out: RecordRichInline[], node: Extract<RecordRichInline, { kind: 'text' }>): void {
  const last = out[out.length - 1];
  if (last && last.kind === 'text' && sameMarks(last.marks, node.marks) && last.href === node.href) {
    last.text += node.text;
    return;
  }
  out.push(node);
}

/** `[label](href)` at the cursor, or `null` — and the cursor untouched — when it is not one. */
function tryLink(cursor: Cursor, marks: RecordRichMark[]): RecordRichInline[] | null {
  const start = cursor.at;
  cursor.at += 1;
  // The address is only known after the label: read the label once to find
  // where it ends, then again with the address on every piece.
  const probe = readInline(cursor, marks, '', { linkLabel: true });
  if (probe && cursor.source[cursor.at] === '(') {
    const close = cursor.source.indexOf(')', cursor.at);
    const href = close === -1 ? '' : cursor.source.slice(cursor.at + 1, close);
    if (close !== -1 && isSafeRecordRichHref(href) && probe.length > 0) {
      const labelCursor: Cursor = { ...cursor, at: start + 1 };
      const label = readInline(labelCursor, marks, href, { linkLabel: true }) ?? [];
      cursor.at = close + 1;
      // A reference inside a label carries no address: a chip is a link of its own.
      return label;
    }
  }
  if (!probe) cursor.exhausted.add('link');
  cursor.at = start;
  return null;
}

function byMarkOrder(a: RecordRichMark, b: RecordRichMark): number {
  return MARK_ORDER.indexOf(a) - MARK_ORDER.indexOf(b);
}

function sameMarks(a: readonly RecordRichMark[], b: readonly RecordRichMark[]): boolean {
  return a.length === b.length && a.every((mark, index) => mark === b[index]);
}

function readLine(line: string): RecordRichInline[] {
  return readInline({ source: line, at: 0, exhausted: new Set() }, [], undefined, null) ?? [];
}

/** The blocks a stored text stands for. The empty text is no blocks. */
export function parseRecordRichText(source: string): RecordRichBlock[] {
  if (source === '') return [];
  const blocks: RecordRichBlock[] = [];
  for (const line of source.split('\n')) {
    const bullet = BULLET_LINE.exec(line);
    if (bullet) {
      const last = blocks[blocks.length - 1];
      const item = readLine(bullet[1] as string);
      if (last?.kind === 'bullet_list') last.items.push(item);
      else blocks.push({ kind: 'bullet_list', items: [item] });
      continue;
    }
    const ordered = ORDERED_LINE.exec(line);
    if (ordered) {
      const last = blocks[blocks.length - 1];
      const item = readLine(ordered[2] as string);
      if (last?.kind === 'ordered_list') last.items.push(item);
      else blocks.push({ kind: 'ordered_list', start: Number(ordered[1]), items: [item] });
      continue;
    }
    // An escaped list marker at the start of a line is the characters of one.
    const escapedOrdered = /^(\d{1,9})\\\. /.exec(line);
    const content = line.startsWith('\\- ')
      ? [{ kind: 'text', text: '- ', marks: [] } as RecordRichInline, ...readLine(line.slice(3))]
      : escapedOrdered
        ? [
            { kind: 'text', text: `${escapedOrdered[1]}. `, marks: [] } as RecordRichInline,
            ...readLine(line.slice(escapedOrdered[0].length)),
          ]
        : readLine(line);
    blocks.push({ kind: 'paragraph', content: mergeTexts(content) });
  }
  return blocks;
}

function mergeTexts(nodes: RecordRichInline[]): RecordRichInline[] {
  const out: RecordRichInline[] = [];
  for (const node of nodes) {
    if (node.kind === 'text') {
      if (node.text === '') continue;
      pushTextNode(out, { ...node, marks: [...node.marks] });
    } else out.push(node);
  }
  return out;
}

// --- Writing ---------------------------------------------------------------------

function escapeText(value: string): string {
  return value.replace(/[\\*_~[\]]/g, (character) => `\\${character}`);
}

/** One line of inline content, with the fewest delimiters that say what it is. */
function writeInline(nodes: readonly RecordRichInline[]): string {
  let out = '';
  let open: RecordRichMark[] = [];
  let link: string | undefined;

  const closeMarksTo = (depth: number): void => {
    while (open.length > depth) out += MARK_DELIMITER[open.pop() as RecordRichMark];
  };
  const closeLink = (): void => {
    if (link === undefined) return;
    closeMarksTo(0);
    out += `](${link})`;
    link = undefined;
  };

  for (const node of nodes) {
    if (node.kind === 'text' && node.text === '') continue;
    const wanted = [...node.marks].sort(byMarkOrder);
    const href = node.kind === 'text' && node.href && isSafeRecordRichHref(node.href) ? node.href : undefined;
    if (href !== link) {
      closeLink();
      if (href !== undefined) {
        out += '[';
        link = href;
      }
    }
    let keep = 0;
    while (keep < open.length && keep < wanted.length && open[keep] === wanted[keep]) keep += 1;
    closeMarksTo(keep);
    for (const mark of wanted.slice(keep)) {
      out += MARK_DELIMITER[mark];
      open.push(mark);
    }
    out += node.kind === 'text' ? escapeText(node.text) : `[[${node.type}:${node.id}]]`;
  }
  closeLink();
  closeMarksTo(0);
  open = [];
  return out;
}

/** The stored text of `blocks` — the inverse of `parseRecordRichText`. */
export function formatRecordRichText(blocks: readonly RecordRichBlock[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      const line = writeInline(block.content);
      // A paragraph that begins like a list item says it is not one.
      lines.push(line.startsWith('- ') ? `\\${line}` : line.replace(/^(\d{1,9})\. /, '$1\\. '));
      continue;
    }
    block.items.forEach((item, index) => {
      const marker = block.kind === 'bullet_list' ? '- ' : `${block.start + index}. `;
      lines.push(`${marker}${writeInline(item)}`);
    });
  }
  return lines.join('\n');
}

/**
 * The text without its formatting, for a place that shows text plainly — an
 * e-mail's text part, a bell entry, a preview. Reference tokens are kept for
 * the caller to resolve; list items keep their markers, links their address.
 */
export function recordRichTextToPlain(source: string): string {
  const inline = (nodes: readonly RecordRichInline[]): string => {
    let out = '';
    let link: string | undefined;
    for (const node of nodes) {
      const href = node.kind === 'text' ? node.href : undefined;
      if (link !== undefined && href !== link) {
        out += ` (${link})`;
        link = undefined;
      }
      if (href !== undefined) link = href;
      out += node.kind === 'text' ? node.text : `[[${node.type}:${node.id}]]`;
    }
    if (link !== undefined) out += ` (${link})`;
    return out;
  };
  const lines: string[] = [];
  for (const block of parseRecordRichText(source)) {
    if (block.kind === 'paragraph') lines.push(inline(block.content));
    else
      block.items.forEach((item, index) =>
        lines.push(`${block.kind === 'bullet_list' ? '- ' : `${block.start + index}. `}${inline(item)}`),
      );
  }
  return lines.join('\n');
}
