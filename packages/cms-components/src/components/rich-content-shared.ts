import { Extension, Mark, Node, mergeAttributes, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import {
  EMPHASIS_VARIANTS,
  SECTION_ANCHOR_RE,
  isInlineIconOffset,
  isInlineIconSize,
  type EmphasisVariant,
} from '@endora-commerce/page-builder-core';
import type { RichContentProps } from '../schema/component-types.js';
import {
  isInertStyle,
  sanitizeHtmlWithPolicy,
  type HtmlSanitizePolicy,
} from '../utils/sanitize-html.js';
import { tiptapJsonToHtml } from './tiptap-html.js';
import { EMPHASIS_COLOR_ATTR, emphasisColor } from './emphasis-color.js';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    emphasis: {
      /** Apply the emphasis mark with `variant`, replacing another variant on the selection. */
      setEmphasis: (variant: EmphasisVariant) => ReturnType;
      /**
       * T175: paint the emphasis on the selection in `color` (a brand colour
       * token or `#rrggbb`), keeping its variant — `accent` where the selection
       * has none; `null` takes the colour off (the stored mark is `{variant}` again) and keeps the emphasis.
       */
      setEmphasisColor: (color: string | null) => ReturnType;
      /** Toggle the emphasis mark with `variant`. */
      toggleEmphasis: (variant: EmphasisVariant) => ReturnType;
      /** Remove the emphasis mark. */
      unsetEmphasis: () => ReturnType;
    };
  }
}

function isEmphasisVariant(value: unknown): value is EmphasisVariant {
  return typeof value === 'string' && (EMPHASIS_VARIANTS as readonly string[]).includes(value);
}

/**
 * The `emphasis` mark (`specs/163-page-builder-marketing-pages/` research R-10):
 * a highlighted phrase in a heading, stored as
 * `{type: 'emphasis', attrs: {variant}}` and rendered as
 * `<span class="cmsc-em cmsc-em--<variant>">` — the markup `InlineRich` writes
 * on the storefront, so the editor shows what the page shows. It is parsed back
 * from that class, so pasted or re-read HTML keeps its variant.
 *
 * T175: an optional `color` (a brand colour token or `#rrggbb`) is written as
 * `data-cms-em-color` (the stored value, read back from it) and the inline
 * `color` it paints; the stylesheet lets it replace the variant's colour (a
 * gradient phrase then reads in that colour). It defaults to `undefined`, so a
 * phrase with none keeps its stored JSON `{variant}` and its markup.
 *
 * The inline rich-text field and `RichContent` (R-14) use it.
 */
export const emphasisMark = Mark.create({
  name: 'emphasis',

  addAttributes() {
    return {
      variant: {
        default: 'accent' satisfies EmphasisVariant,
        parseHTML: (element: HTMLElement): EmphasisVariant =>
          EMPHASIS_VARIANTS.find((variant) => element.classList.contains(`cmsc-em--${variant}`)) ?? 'accent',
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> => ({
          class: `cmsc-em cmsc-em--${isEmphasisVariant(attributes.variant) ? attributes.variant : 'accent'}`,
        }),
      },
      // T175: written after the variant, so the class precedes the colour in the markup.
      color: {
        default: undefined,
        parseHTML: (element: HTMLElement): string | undefined =>
          emphasisColor(element.getAttribute(EMPHASIS_COLOR_ATTR))?.value,
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
          const color = emphasisColor(attributes.color);
          return color ? { [EMPHASIS_COLOR_ATTR]: color.value, style: `color: ${color.css}` } : {};
        },
      },
    };
  },

  parseHTML() {
    // T175: ahead of `textStyle`, which reads any styled span — a coloured emphasis is one mark, not two.
    return [{ tag: 'span.cmsc-em', priority: 60 }];
  },

  renderHTML(props) {
    return ['span', mergeAttributes(props.HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setEmphasis:
        (variant) =>
        ({ commands }) =>
          commands.setMark(this.name, { variant }),
      toggleEmphasis:
        (variant) =>
        ({ editor, commands }) =>
          editor.isActive(this.name, { variant })
            ? commands.unsetMark(this.name, { extendEmptyMarkRange: true })
            : commands.setMark(this.name, { variant }),
      setEmphasisColor:
        (color) =>
        ({ editor, commands }) => {
          const current = editor.getAttributes(this.name) as { variant?: unknown };
          const variant = isEmphasisVariant(current.variant) ? current.variant : 'accent';
          return commands.setMark(this.name, { variant, color: emphasisColor(color)?.value });
        },
      unsetEmphasis:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name, { extendEmptyMarkRange: true }),
    };
  },
});

/** An icon name as the stored grammar takes it (`INLINE_ICON_NAME_RE` of the contracts, restated). */
const INLINE_ICON_NAME_RE = /^[a-z][A-Za-z0-9]{0,63}$/;

/**
 * T163: an icon of the page builder's catalog inside inline rich text (a
 * heading, a caption), stored as `{type: 'inlineIcon', attrs: {name}}` — one
 * atomic inline node, so the translation codec carries it as one `<n/>` tag.
 *
 * The page renders it through `InlineRich` (inline SVG). As HTML — the
 * clipboard, `getHTML()`, the DOM-free serializer — it is an empty
 * `<span class="cmsc-inline-icon" data-cms-icon="<name>" aria-hidden="true">`,
 * read back into the same node; the inline editor draws the icon itself with a
 * node view.
 *
 * T166: `size` (`'0.5em'`–`'3em'` or `'8px'`–`'200px'`) and `offset` (em of
 * the text, −1–1) are written as `data-cms-icon-size` / `data-cms-icon-offset`
 * and read back; a value outside the grammar is dropped. Both default to
 * `undefined`, so an icon with neither keeps its stored JSON `{name}` and its
 * T163 markup.
 */
export const inlineIconNode = Node.create({
  name: 'inlineIcon',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      name: {
        default: null,
        parseHTML: (element: HTMLElement): string | null => {
          const name = element.getAttribute('data-cms-icon');
          return name !== null && INLINE_ICON_NAME_RE.test(name) ? name : null;
        },
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> =>
          typeof attributes.name === 'string' && INLINE_ICON_NAME_RE.test(attributes.name) ? { 'data-cms-icon': attributes.name } : {},
      },
      size: {
        default: undefined,
        parseHTML: (element: HTMLElement): string | undefined => {
          const size = element.getAttribute('data-cms-icon-size');
          return isInlineIconSize(size) ? size : undefined;
        },
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> =>
          isInlineIconSize(attributes.size) ? { 'data-cms-icon-size': attributes.size } : {},
      },
      offset: {
        default: undefined,
        parseHTML: (element: HTMLElement): number | undefined => {
          const raw = element.getAttribute('data-cms-icon-offset');
          const offset = raw === null || raw.trim() === '' ? Number.NaN : Number(raw);
          return isInlineIconOffset(offset) ? offset : undefined;
        },
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> =>
          isInlineIconOffset(attributes.offset) ? { 'data-cms-icon-offset': String(attributes.offset) } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span.cmsc-inline-icon[data-cms-icon]' }];
  },

  renderHTML(props) {
    return ['span', mergeAttributes({ class: 'cmsc-inline-icon' }, props.HTMLAttributes, { 'aria-hidden': 'true' })];
  },
});

// ── Rich text extensions (feature 163, research R-14) ────────────────

/** The `cmsc-btn--<style>-<fill>` pairs a button-styled link may carry (R-11's button classes). */
export const BUTTON_LINK_VARIANTS: readonly string[] = ['primary', 'secondary', 'light', 'dark'].flatMap((style) =>
  ['solid', 'outline', 'text'].map((fill) => `${style}-${fill}`),
);

function isButtonLinkVariant(value: unknown): value is string {
  return typeof value === 'string' && BUTTON_LINK_VARIANTS.includes(value);
}

function isAnchor(value: unknown): value is string {
  return typeof value === 'string' && SECTION_ANCHOR_RE.test(value);
}

/** The summary line of a read-more passage: the text a visitor opens it with. */
export const readMoreSummaryNode = Node.create({
  name: 'readMoreSummary',
  content: 'inline*',
  defining: true,
  parseHTML() {
    return [{ tag: 'summary' }];
  },
  renderHTML() {
    return ['summary', 0];
  },
});

/** T168: how a read-more passage shows its summary — the text (today's) or a bare chevron. */
export const READ_MORE_SUMMARY_STYLES = ['text', 'chevron'] as const;
export type ReadMoreSummaryStyle = (typeof READ_MORE_SUMMARY_STYLES)[number];

/** T173: where the summary — its text or its chevron — sits on its line; `start` is today's. */
export const READ_MORE_POSITIONS = ['start', 'center', 'end'] as const;
export type ReadMorePosition = (typeof READ_MORE_POSITIONS)[number];

/**
 * A collapsible "read more" passage: `<details class="cmsc-read-more">` with a
 * summary and any blocks. It needs no script and its content stays in the HTML
 * (SC-005). The editor shows it open, so its content can be edited.
 *
 * T168: `summaryStyle: 'chevron'` adds `cmsc-read-more--chevron`; the
 * stylesheet then draws a bare chevron and hides the summary text visually,
 * which stays the control's accessible name. `text` (the default) writes
 * today's markup.
 *
 * T173: `chevronPosition: 'center' | 'end'` adds `cmsc-read-more--center` /
 * `--end` (the summary, text or chevron, on that side of its line; `start`, the
 * default, writes nothing), and `revealAbove: true` adds
 * `cmsc-read-more--reveal-above` — while open, the stylesheet shows the hidden
 * text above the summary. The DOM order never changes: the summary stays the
 * first child and the one control, for the keyboard and assistive technology.
 */
export const readMoreNode = Node.create({
  name: 'readMore',
  group: 'block',
  content: 'readMoreSummary block+',
  defining: true,

  addAttributes() {
    return {
      open: {
        default: false,
        parseHTML: (element: HTMLElement): boolean => element.hasAttribute('open'),
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> =>
          attributes.open === true ? { open: '' } : {},
      },
      summaryStyle: {
        default: 'text',
        parseHTML: (element: HTMLElement): ReadMoreSummaryStyle =>
          element.classList.contains('cmsc-read-more--chevron') ? 'chevron' : 'text',
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> =>
          attributes.summaryStyle === 'chevron' ? { class: 'cmsc-read-more--chevron' } : {},
      },
      chevronPosition: {
        default: 'start',
        parseHTML: (element: HTMLElement): ReadMorePosition =>
          element.classList.contains('cmsc-read-more--center')
            ? 'center'
            : element.classList.contains('cmsc-read-more--end')
              ? 'end'
              : 'start',
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> =>
          attributes.chevronPosition === 'center' || attributes.chevronPosition === 'end'
            ? { class: `cmsc-read-more--${attributes.chevronPosition}` }
            : {},
      },
      revealAbove: {
        default: false,
        parseHTML: (element: HTMLElement): boolean => element.classList.contains('cmsc-read-more--reveal-above'),
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> =>
          attributes.revealAbove === true ? { class: 'cmsc-read-more--reveal-above' } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'details' }];
  },

  renderHTML(props) {
    return ['details', mergeAttributes({ class: 'cmsc-read-more' }, props.HTMLAttributes), 0];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.className = 'cmsc-read-more cmsc-read-more--editing';
      // T168: the editor keeps the summary text editable and marks a chevron passage;
      // T173: and the summary's position and a reveal above (the content stays below, editable).
      const mark = (attrs: Record<string, unknown>): void => {
        if (attrs['summaryStyle'] === 'chevron') dom.dataset['summaryStyle'] = 'chevron';
        else delete dom.dataset['summaryStyle'];
        const position = attrs['chevronPosition'];
        if (position === 'center' || position === 'end') dom.dataset['position'] = position;
        else delete dom.dataset['position'];
        if (attrs['revealAbove'] === true) dom.dataset['revealAbove'] = 'true';
        else delete dom.dataset['revealAbove'];
      };
      mark(node.attrs);
      return {
        dom,
        contentDOM: dom,
        update: (next) => {
          if (next.type.name !== 'readMore') return false;
          mark(next.attrs);
          return true;
        },
      };
    };
  },
});

/**
 * A new read-more passage: a summary line to edit and one empty paragraph.
 *
 * `summary` is content seeded into the document, not UI copy: it is saved with
 * the page and shown on the storefront, so it is not read from the field text
 * in the operator's admin language (#1680). Seeding it from the edited content
 * locale is tracked in a follow-up issue.
 */
export function readMoreContent(summary: string): JSONContent {
  return {
    type: 'readMore',
    content: [
      { type: 'readMoreSummary', content: [{ type: 'text', text: summary }] },
      { type: 'paragraph' },
    ],
  };
}

/**
 * The attributes R-14 adds to StarterKit's nodes and marks, each written as a
 * class or a pattern-checked `id`: a heading's `anchor` (`id`, only when it is
 * a valid anchor) and `srOnly` (`cmsc-sr-only`), a bullet list's
 * `listStyle: 'check'` (`cmsc-list--check`) and a link's button `variant`
 * (`cmsc-btn cmsc-btn--<variant>`).
 */
// ── Images: size, alignment, inline (T128) ───────────────────────────

/** A rich-text image's width: whole px up to 4 digits, or a whole % up to 100. */
export const RICH_IMAGE_SIZE_RE = /^(?:\d{1,4}px|(?:100|[1-9]?\d)%)$/;
export const RICH_IMAGE_ALIGNS = ['left', 'center', 'right'] as const;
export type RichImageAlign = (typeof RICH_IMAGE_ALIGNS)[number];

function isRichImageSize(value: unknown): value is string {
  return typeof value === 'string' && RICH_IMAGE_SIZE_RE.test(value);
}

function isRichImageAlign(value: unknown): value is RichImageAlign {
  return typeof value === 'string' && (RICH_IMAGE_ALIGNS as readonly string[]).includes(value);
}

/** The `width` declaration of an element's inline style, when it is a size a rich image takes. */
function sizeFromStyle(element: HTMLElement): string | null {
  const match = /(?:^|;)\s*width\s*:\s*([^;]+)/i.exec(element.getAttribute('style') ?? '');
  const value = match?.[1]?.trim() ?? '';
  return isRichImageSize(value) ? value : null;
}

/** `size`: a width in px or %, written as the image's `width` style (never a free style). */
const sizeAttribute = {
  default: null,
  parseHTML: (element: HTMLElement): string | null => sizeFromStyle(element),
  renderHTML: (attributes: Record<string, unknown>): Record<string, string> =>
    isRichImageSize(attributes.size) ? { class: 'cmsc-rich-img', style: `width: ${attributes.size}` } : {},
};

/**
 * The image node (`specs/163-page-builder-marketing-pages/` T128): TipTap's
 * block image plus an `align` (left, center, right — a class) and a `size` (a
 * width in px or % — the `width` style). An image stored before has neither
 * and renders as it did. `align` is declared first, so the class precedes the
 * style in the markup.
 */
export const richImageNode = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: null,
        parseHTML: (element: HTMLElement): RichImageAlign | null =>
          RICH_IMAGE_ALIGNS.find((align) => element.classList.contains(`cmsc-rich-img--${align}`)) ?? null,
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> =>
          isRichImageAlign(attributes.align) ? { class: `cmsc-rich-img cmsc-rich-img--${attributes.align}` } : {},
      },
      size: sizeAttribute,
    };
  },
}).configure({ inline: false, allowBase64: false });

/**
 * An image in the line of text (T128): a logo inside a sentence, an avatar
 * group before a caption. An inline node of its own, since a ProseMirror node
 * is either inline or a block; it renders
 * `<img class="cmsc-rich-img cmsc-rich-img--inline">` and is read back from
 * that class.
 */
export const inlineImageNode = Node.create({
  name: 'inlineImage',
  inline: true,
  group: 'inline',
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      size: sizeAttribute,
    };
  },

  parseHTML() {
    return [{ tag: 'img.cmsc-rich-img--inline[src]:not([src^="data:"])', priority: 60 }];
  },

  renderHTML({ HTMLAttributes: attributes }) {
    return ['img', mergeAttributes(attributes, { class: 'cmsc-rich-img cmsc-rich-img--inline' })];
  },
});

/** R19A (T233): a bullet list's marker besides the disc (unset): a check mark, a chevron, or none. */
export const LIST_MARKERS = ['check', 'chevron', 'none'] as const;
export type ListMarker = (typeof LIST_MARKERS)[number];

function isListMarker(value: unknown): value is ListMarker {
  return typeof value === 'string' && (LIST_MARKERS as readonly string[]).includes(value);
}

// ── Text size on a run (R19A, T233) ──────────────────────────────────

/** The type tokens a run may take, smallest first. */
export const TEXT_SIZE_TOKENS = ['small', 'body', 'lead', 'h6', 'h5', 'h4', 'h3', 'h2', 'h1', 'display'] as const;
export type TextSizeToken = (typeof TEXT_SIZE_TOKENS)[number];
/**
 * A Custom size: whole px, 8–200. R23 (T442): no longer offered — a run takes a
 * type token — but a Custom px stored by R19A is still read and written as it
 * was, so a stored page renders unchanged.
 */
export const TEXT_SIZE_PX_RE = /^(?:[89]|[1-9]\d|1\d\d|200)px$/;

function isTextSizeToken(value: unknown): value is TextSizeToken {
  return typeof value === 'string' && (TEXT_SIZE_TOKENS as readonly string[]).includes(value);
}

export function isTextSize(value: unknown): value is string {
  return isTextSizeToken(value) || (typeof value === 'string' && TEXT_SIZE_PX_RE.test(value));
}

/** R23 (T442): what the editor may set — a type token. */
export function isSettableTextSize(value: unknown): value is TextSizeToken {
  return isTextSizeToken(value);
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textSize: {
      /** Size the selection: a type token (`lead`, `h4`, …). R23 (T442): a Custom px is no longer set. */
      setTextSize: (size: string) => ReturnType;
      /** Back to the text's own size. */
      unsetTextSize: () => ReturnType;
    };
  }
}

/**
 * R19A (T233): a run's text size, stored as `{type: 'textSize', attrs: {size}}`
 * — a type token, written `<span class="cmsc-fs cmsc-fs--<token>">` (the
 * stylesheet gives it the token's size per breakpoint), or a Custom px,
 * written `<span class="cmsc-fs" style="font-size: Npx">`. Read back from that
 * markup; a size outside the grammar writes no size. Its own mark, so the
 * colour (`textStyle`) and the emphasis stay what they are.
 */
export const textSizeMark = Mark.create({
  name: 'textSize',

  addAttributes() {
    return {
      size: {
        default: null,
        parseHTML: (element: HTMLElement): string | null => {
          const token = TEXT_SIZE_TOKENS.find((name) => element.classList.contains(`cmsc-fs--${name}`));
          if (token) return token;
          const px = /(?:^|;)\s*font-size\s*:\s*([^;]+)/i.exec(element.getAttribute('style') ?? '')?.[1]?.trim() ?? '';
          return TEXT_SIZE_PX_RE.test(px) ? px : null;
        },
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
          const size = attributes.size;
          if (isTextSizeToken(size)) return { class: `cmsc-fs cmsc-fs--${size}` };
          if (typeof size === 'string' && TEXT_SIZE_PX_RE.test(size)) return { class: 'cmsc-fs', style: `font-size: ${size}` };
          return { class: 'cmsc-fs' };
        },
      },
    };
  },

  parseHTML() {
    // Ahead of `textStyle`, which reads any styled span.
    return [{ tag: 'span.cmsc-fs', priority: 60 }];
  },

  renderHTML(props) {
    return ['span', mergeAttributes(props.HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setTextSize:
        (size) =>
        ({ commands }) =>
          isSettableTextSize(size) ? commands.setMark(this.name, { size }) : commands.unsetMark(this.name),
      unsetTextSize:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name, { extendEmptyMarkRange: true }),
    };
  },
});

export const richContentAttributes = Extension.create({
  name: 'richContentAttributes',

  addGlobalAttributes() {
    return [
      {
        types: ['heading'],
        attributes: {
          anchor: {
            default: null,
            parseHTML: (element: HTMLElement): string | null => {
              const id = element.getAttribute('id');
              return isAnchor(id) ? id : null;
            },
            renderHTML: (attributes: Record<string, unknown>): Record<string, string> =>
              isAnchor(attributes.anchor) ? { id: attributes.anchor } : {},
          },
          srOnly: {
            default: false,
            parseHTML: (element: HTMLElement): boolean => element.classList.contains('cmsc-sr-only'),
            renderHTML: (attributes: Record<string, unknown>): Record<string, string> =>
              attributes.srOnly === true ? { class: 'cmsc-sr-only' } : {},
          },
        },
      },
      {
        types: ['bulletList'],
        attributes: {
          // R19A (T233): `check`, `chevron` or `none` — a class; unset (or anything else) is the disc.
          listStyle: {
            default: null,
            parseHTML: (element: HTMLElement): ListMarker | null =>
              LIST_MARKERS.find((marker) => element.classList.contains(`cmsc-list--${marker}`)) ?? null,
            renderHTML: (attributes: Record<string, unknown>): Record<string, string> =>
              isListMarker(attributes.listStyle) ? { class: `cmsc-list--${attributes.listStyle}` } : {},
          },
        },
      },
      {
        types: ['link'],
        attributes: {
          variant: {
            default: null,
            parseHTML: (element: HTMLElement): string | null =>
              BUTTON_LINK_VARIANTS.find((variant) => element.classList.contains(`cmsc-btn--${variant}`)) ?? null,
            renderHTML: (attributes: Record<string, unknown>): Record<string, string> =>
              isButtonLinkVariant(attributes.variant) ? { class: `cmsc-btn cmsc-btn--${attributes.variant}` } : {},
          },
        },
      },
    ];
  },
});

export const richContentExtensions = [
  StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  TextStyle,
  Color,
  Highlight.configure({ multicolor: true }),
  richImageNode,
  inlineImageNode,
  emphasisMark,
  textSizeMark,
  readMoreNode,
  readMoreSummaryNode,
  richContentAttributes,
];

const allowedTags = new Set([
  'p',
  'br',
  'strong',
  'em',
  's',
  'u',
  'blockquote',
  'code',
  'pre',
  'hr',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a',
  'img',
  'span',
  'mark',
  // R-14: a read-more passage.
  'details',
  'summary',
]);

const GLOBAL_ATTRS = new Set(['class', 'style']);

const allowedAttrs: Record<string, Set<string>> = {
  a: new Set(['href', 'title', 'target', 'rel']),
  img: new Set(['src', 'alt', 'title', 'width', 'height']),
  mark: new Set(['data-color']),
  details: new Set(['open']),
};

/** T175: an emphasis keeps its colour attribute, on a `<span>` and with a colour value only. */
function isEmphasisColorAttr(tag: string, attr: string, value: string): boolean {
  return tag === 'span' && attr === EMPHASIS_COLOR_ATTR && emphasisColor(value) !== null;
}

/** R-14: a heading keeps an `id` only when it is a valid anchor (R-8's pattern). */
const ANCHORED_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

const SAFE_STYLE_VALUES: Record<string, RegExp> = {
  color: /^[#\w\s(),.%-]+$/,
  'background-color': /^[#\w\s(),.%-]+$/,
  'text-align': /^(left|right|center|justify|start|end)$/i,
};

/** T128: an image's size, and on an `<img>` only. */
const IMAGE_STYLE_VALUES: Record<string, RegExp> = { width: RICH_IMAGE_SIZE_RE };

/** R19A (T233): a run's Custom size, whole px, and on a `<span>` only. */
const SPAN_STYLE_VALUES: Record<string, RegExp> = { 'font-size': TEXT_SIZE_PX_RE };

/**
 * Keeps the declarations the rich text editor writes — colours and alignment,
 * and an image's width in px or % (T128) — and nothing else.
 */
function sanitizeStyleAttr(style: string, tag?: string): string | null {
  const kept: string[] = [];
  for (const declaration of style.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon === -1) continue;
    const prop = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    const pattern =
      SAFE_STYLE_VALUES[prop] ?? (tag === 'img' ? IMAGE_STYLE_VALUES[prop] : tag === 'span' ? SPAN_STYLE_VALUES[prop] : undefined);
    if (!pattern || !pattern.test(value) || !isInertStyle(value)) continue;
    kept.push(`${prop}: ${value}`);
  }
  return kept.length > 0 ? kept.join('; ') : null;
}

const richContentPolicy: HtmlSanitizePolicy = {
  allowTag: (tag) => allowedTags.has(tag),
  allowAttr: (tag, attr, value) =>
    GLOBAL_ATTRS.has(attr) ||
    allowedAttrs[tag]?.has(attr) === true ||
    (attr === 'id' && ANCHORED_TAGS.has(tag) && isAnchor(value)) ||
    isEmphasisColorAttr(tag, attr, value),
  cleanStyle: sanitizeStyleAttr,
  allowStyleElement: false,
};

/** Sanitises rich-content HTML. Pure and DOM-free — identical on server and client. */
export function sanitizeRichHtml(html: string): string {
  if (typeof html !== 'string' || html === '') return '';
  return sanitizeHtmlWithPolicy(html, richContentPolicy);
}

/**
 * A stored TipTap document as sanitized HTML. DOM-free (T119): the same string
 * on the server and in the browser, so a rich body is in the server HTML and
 * hydrates without a mismatch. Content the schema does not know renders nothing.
 */
export function htmlFromTiptap(content: JSONContent | null): string {
  if (!content) return '';

  try {
    return sanitizeRichHtml(tiptapJsonToHtml(content, richContentExtensions));
  } catch {
    return '';
  }
}

/**
 * The prose look of `cms.RichContent`. Colours, body size, line height and the
 * heading font are `.cmsc-pb-rich-content`'s (the stylesheet): they read the
 * section's scheme (`--cmsb-fg`, `--cmsb-link`, `--cmsb-fg-muted`,
 * `--cmsb-border`) and the brand's type tokens, each with today's literal as
 * its fallback (T120, standing rule 9); the rest is layout.
 */
export const RICH_CONTENT_PROSE_CLASS =
  'cmsc-pb-rich-content cmsc:font-sans cmsc:[&_h1]:text-[32px] cmsc:[&_h2]:text-[26px] cmsc:[&_h3]:text-[22px] cmsc:[&_h4]:text-[18px] cmsc:[&_h1]:font-bold cmsc:[&_h2]:font-bold cmsc:[&_h3]:font-bold cmsc:[&_h4]:font-bold cmsc:[&_ul]:list-disc cmsc:[&_ol]:list-decimal cmsc:[&_ul]:pl-[24px] cmsc:[&_ol]:pl-[24px] cmsc:[&_blockquote]:border-l-4 cmsc:[&_blockquote]:pl-[14px] cmsc:[&_blockquote]:italic cmsc:[&_a]:underline cmsc:[&_pre]:bg-[#0f172a] cmsc:[&_pre]:text-white cmsc:[&_pre]:rounded-[8px] cmsc:[&_pre]:p-[12px] cmsc:[&_pre]:overflow-auto cmsc:[&_code]:font-mono cmsc:[&_img]:max-w-full cmsc:[&_img]:h-auto cmsc:[&_img]:rounded-[8px]';

function parseJsonContent(value: unknown): JSONContent | null {
  if (!value) return null;
  if (typeof value === 'object') return value as JSONContent;
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as JSONContent) : null;
  } catch {
    return null;
  }
}

function hasTiptapBody(content: JSONContent | null): boolean {
  return Boolean(content && Array.isArray(content.content) && content.content.length > 0);
}

/** Normalize persisted RichContent props for storefront + editor rendering. */
export function coerceRichContentProps(props: RichContentProps): RichContentProps {
  const parsedContent = parseJsonContent(props.content);
  const html = typeof props.html === 'string' ? props.html : '';
  const generated = htmlFromTiptap(parsedContent);

  if (hasTiptapBody(parsedContent)) {
    return {
      ...props,
      content: parsedContent,
      html: generated || html,
    };
  }

  if (html.trim()) {
    return {
      ...props,
      content: parsedContent,
      html: sanitizeRichHtml(html),
    };
  }

  return {
    ...props,
    content: parsedContent,
    html: '',
  };
}

export function resolveRichContentHtml(props: RichContentProps): string {
  const normalized = coerceRichContentProps(props);
  return htmlFromTiptap(normalized.content) || sanitizeRichHtml(normalized.html);
}

export const defaultRichContent: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Rich content section' }],
    },
  ],
};
