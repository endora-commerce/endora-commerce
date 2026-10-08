import {
  formatOpportunityReferenceToken,
  splitOpportunityReferenceText,
  type OpportunityReferenceToken,
  type OpportunityReferenceType,
} from '@endora-commerce/contracts';

/**
 * The editing field's DOM, and the text it stands for (User Story 18, research
 * N-M11).
 *
 * **The stored text is the model; the DOM is a rendering of it.** The field
 * holds exactly three kinds of node, all direct children of its root:
 *
 * - a text node — characters as typed;
 * - a `<br>` — a line break (`\n` in the text);
 * - a chip — a non-editable `<span>` carrying the token it stands for in
 *   `data-crm-token`, and showing the name that token resolves to.
 *
 * Everything here goes between the two: `renderReferenceText` draws a text,
 * `readReferenceText` reads one back, and the two offset functions turn a DOM
 * position into a position in the text and back — so that every structural
 * edit (a mention chosen, a paste, a line break, a chip removed, an undo) is
 * made on the text and drawn again, and only plain typing is the browser's.
 *
 * **A token the field cannot name is never rewritten.** It is drawn as the
 * characters it is, and read back as the same characters.
 */

export const CHIP_TOKEN_ATTRIBUTE = 'data-crm-token';

/** What a chip shows for one token, or `null` when the field does not know the target. */
export interface ChipFace {
  text: string;
  available: boolean;
  type: OpportunityReferenceType;
}

export type DescribeToken = (token: OpportunityReferenceToken) => ChipFace | null;

const CHIP_CLASS =
  'mx-0.5 inline-block rounded border px-1.5 align-baseline text-xs leading-5 whitespace-nowrap';
const CHIP_KIND_CLASS: Record<OpportunityReferenceType, string> = {
  admin_user: 'border-primary/30 bg-primary/10 font-medium text-foreground',
  order: 'border-border bg-muted/50 font-medium text-foreground',
  product: 'border-border bg-muted/50 font-medium text-foreground',
};
const CHIP_UNAVAILABLE_CLASS = 'border-dashed border-border text-muted-foreground';

function isElement(node: Node): node is HTMLElement {
  return node.nodeType === 1;
}

export function isChip(node: Node | null | undefined): boolean {
  return Boolean(node) && isElement(node as Node) && (node as HTMLElement).hasAttribute(CHIP_TOKEN_ATTRIBUTE);
}

function tokenOf(chip: Node): string {
  return (chip as HTMLElement).getAttribute(CHIP_TOKEN_ATTRIBUTE) ?? '';
}

function isBreak(node: Node): boolean {
  return isElement(node) && node.tagName === 'BR';
}

/** Draw `text` into `root`, replacing whatever it held. */
export function renderReferenceText(root: HTMLElement, text: string, describe: DescribeToken): void {
  const document = root.ownerDocument;
  const fragment = document.createDocumentFragment();
  const plain = (value: string): void => {
    const lines = value.split('\n');
    lines.forEach((line, index) => {
      if (index > 0) fragment.appendChild(document.createElement('br'));
      if (line !== '') fragment.appendChild(document.createTextNode(line));
    });
  };
  for (const part of splitOpportunityReferenceText(text)) {
    if (part.kind === 'text') {
      plain(part.text);
      continue;
    }
    const token = formatOpportunityReferenceToken(part.type, part.id);
    const face = describe({ type: part.type, id: part.id });
    if (!face) {
      // Not known here: the characters, exactly — never a guess, never a loss.
      plain(token);
      continue;
    }
    const chip = document.createElement('span');
    chip.setAttribute(CHIP_TOKEN_ATTRIBUTE, token);
    chip.setAttribute('contenteditable', 'false');
    chip.className = `${CHIP_CLASS} ${face.available ? CHIP_KIND_CLASS[face.type] : CHIP_UNAVAILABLE_CLASS}`;
    chip.textContent = face.text;
    fragment.appendChild(chip);
  }
  // A line break at the very end draws no line of its own; the browser needs
  // one more to show the empty last line. It is never read back.
  if (text.endsWith('\n')) fragment.appendChild(document.createElement('br'));
  root.replaceChildren(fragment);
}

/**
 * The text a tree of nodes stands for. `whole` says the nodes are the field's
 * entire content, where the last `<br>` is the one that only draws the empty
 * last line (ours, or the placeholder a browser leaves in an emptied field).
 */
function readNodes(nodes: ArrayLike<Node>, whole: boolean): string {
  let text = '';
  const list = Array.from(nodes);
  list.forEach((node, index) => {
    if (node.nodeType === 3) {
      text += (node.nodeValue ?? '').replace(/ /g, ' ');
      return;
    }
    if (!isElement(node)) return;
    if (isChip(node)) {
      text += tokenOf(node);
      return;
    }
    if (isBreak(node)) {
      if (!(whole && index === list.length - 1)) text += '\n';
      return;
    }
    // Something a browser put there on its own — a `<div>` for a new line, a
    // `<span>` from a drop. Its text is kept; a block starts on a line of its own.
    const block = /^(DIV|P|LI|H[1-6]|BLOCKQUOTE|PRE)$/.test(node.tagName);
    if (block && text !== '' && !text.endsWith('\n')) text += '\n';
    text += readNodes(node.childNodes, false);
  });
  return text;
}

/** The text the field holds now — tokens for chips, `\n` for line breaks. */
export function readReferenceText(root: HTMLElement): string {
  return readNodes(root.childNodes, true);
}

/** Whether the field holds only what `renderReferenceText` draws. */
export function isCanonical(root: HTMLElement): boolean {
  return Array.from(root.childNodes).every((node) => node.nodeType === 3 || isBreak(node) || isChip(node));
}

/** The position in the text of a DOM position inside `root`. */
export function textOffsetOf(root: HTMLElement, container: Node, offset: number): number {
  // A position inside a chip is the position after it.
  let node: Node | null = container;
  while (node && node !== root) {
    if (isChip(node)) {
      const parent: Node | null = node.parentNode;
      if (!parent) break;
      return textOffsetOf(root, parent, Array.prototype.indexOf.call(parent.childNodes, node) + 1);
    }
    node = node.parentNode;
  }
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(container, offset);
  } catch {
    return readReferenceText(root).length;
  }
  const length = readNodes(range.cloneContents().childNodes, false).length;
  // The break that only draws the last line counts for nothing.
  return Math.min(length, readReferenceText(root).length);
}

/** The DOM position of a position in the text. */
export function domPositionOf(root: HTMLElement, offset: number): { node: Node; offset: number } {
  let remaining = Math.max(0, offset);
  const children = Array.from(root.childNodes);
  for (let index = 0; index < children.length; index += 1) {
    const node = children[index] as Node;
    if (node.nodeType === 3) {
      const length = (node.nodeValue ?? '').length;
      if (remaining <= length) return { node, offset: remaining };
      remaining -= length;
      continue;
    }
    const length = isChip(node)
      ? tokenOf(node).length
      : isBreak(node)
        ? index === children.length - 1
          ? 0
          : 1
        : readNodes(node.childNodes, false).length;
    if (remaining === 0) return { node: root, offset: index };
    // Inside a chip there is no position: before it or after it.
    if (remaining < length) return { node: root, offset: index + 1 };
    remaining -= length;
  }
  // After everything — but before the break that only draws the last line.
  const last = children[children.length - 1];
  const trailing = last && isBreak(last) && children.length > 1 && isBreak(children[children.length - 2] as Node);
  return { node: root, offset: trailing ? children.length - 1 : children.length };
}

/** The selection inside `root` as positions in the text, or `null` when it is elsewhere. */
export function selectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const start = textOffsetOf(root, range.startContainer, range.startOffset);
  const end = range.collapsed ? start : textOffsetOf(root, range.endContainer, range.endOffset);
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

/** Put the caret — or a selection — at positions in the text. */
export function selectOffsets(root: HTMLElement, start: number, end = start): void {
  const selection = root.ownerDocument.getSelection();
  if (!selection) return;
  const range = root.ownerDocument.createRange();
  const from = domPositionOf(root, start);
  range.setStart(from.node, from.offset);
  if (end === start) {
    range.collapse(true);
  } else {
    const to = domPositionOf(root, end);
    range.setEnd(to.node, to.offset);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * The token a collapsed caret at `offset` touches — the chip Backspace
 * (`before`) or Delete (`after`) takes whole — as a stretch of the text.
 */
export function chipBeside(
  root: HTMLElement,
  offset: number,
  side: 'before' | 'after',
): { start: number; end: number } | null {
  let position = 0;
  for (const node of Array.from(root.childNodes)) {
    const length = node.nodeType === 3 ? (node.nodeValue ?? '').length : readNodes([node], false).length;
    const start = position;
    const end = position + length;
    if (isChip(node)) {
      if (side === 'before' && end === offset) return { start, end };
      if (side === 'after' && start === offset) return { start, end };
    }
    position = end;
  }
  return null;
}

/**
 * Where a position of the text is on screen: the box of the character there,
 * or `null` where the platform cannot say (no layout — a test's DOM).
 */
export function rectOfOffset(root: HTMLElement, offset: number): DOMRect | null {
  const range = root.ownerDocument.createRange();
  const from = domPositionOf(root, offset);
  range.setStart(from.node, from.offset);
  // One character wide when there is one: a collapsed range has no box in
  // every engine.
  if (from.node.nodeType === 3 && from.offset < (from.node.nodeValue ?? '').length) {
    range.setEnd(from.node, from.offset + 1);
  } else {
    range.collapse(true);
  }
  if (typeof range.getBoundingClientRect !== 'function') return null;
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.left === 0) return null;
  return rect;
}
