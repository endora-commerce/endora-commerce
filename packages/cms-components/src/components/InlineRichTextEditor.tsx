'use client';

import { Extension, Node, type JSONContent } from '@tiptap/core';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type ReactNodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  BRAND_COLOR_ROLES,
  EMPHASIS_VARIANTS,
  HEX_COLOR_RE,
  INLINE_ICON_OFFSET_EM,
  INLINE_ICON_SIZE_EM,
  INLINE_ICON_SIZE_PX,
  isInlineIconOffset,
  isInlineIconSize,
  NativeColorInput,
  plainTextToInlineRichText,
  useFieldText,
  type InlineRichText,
} from '@endora-commerce/page-builder-core';
import { InlineRich, inlineIconPresentation } from './InlineRich.js';
import { Divider, EMPHASIS_LABELS, LinkDialog, ToolbarButton } from './RichContentEditorField.js';
import { emphasisMark, inlineIconNode } from './rich-content-shared.js';
import { CMS_ICON_CATALOG, humanizeIconName, resolveCmsIcon, type CmsIconName } from './icon-catalog.js';
import { emphasisColor } from './emphasis-color.js';
import { CmsModalDialog } from './CmsModalDialog.js';

/** A document of exactly one paragraph — the inline grammar's top node (data-model §3.5). */
const InlineDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: 'paragraph',
});

/** Enter writes a hard break: a heading has no second paragraph to split into. */
const EnterWritesHardBreak = Extension.create({
  name: 'inlineEnterWritesHardBreak',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.setHardBreak(),
    };
  },
});

/** T163: the inline icon as the editor shows it — the catalog's icon, as the page draws it. */
function InlineIconView({ node, selected }: ReactNodeViewProps): ReactElement {
  const Icon = resolveCmsIcon(node.attrs.name as string | undefined);
  // T166: the size and offset as the page draws them.
  const { size, style } = inlineIconPresentation(node.attrs);
  return (
    <NodeViewWrapper as="span" className={`cmsc-inline-icon-node${selected ? ' cmsc-inline-icon-node--selected' : ''}`}>
      {Icon ? <Icon className="cmsc-inline-icon" size={size} aria-hidden="true" focusable="false" {...(style ? { style } : {})} /> : null}
    </NodeViewWrapper>
  );
}

const InlineIconEditing = inlineIconNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(InlineIconView, { as: 'span' });
  },
});

/**
 * The TipTap extensions of inline rich text (research R-10): text, one
 * paragraph, hard breaks, bold, italic, link, `emphasis` and an icon of the
 * catalog (T163) — and nothing that
 * makes a block (heading, list, quote, code, rule) or a mark the stored grammar
 * does not carry (underline, strike, inline code).
 */
export const inlineRichTextExtensions = [
  InlineDocument,
  StarterKit.configure({
    document: false,
    blockquote: false,
    bulletList: false,
    code: false,
    codeBlock: false,
    dropcursor: false,
    gapcursor: false,
    heading: false,
    horizontalRule: false,
    listItem: false,
    listKeymap: false,
    orderedList: false,
    strike: false,
    trailingNode: false,
    underline: false,
    link: { openOnClick: false, autolink: false },
  }),
  emphasisMark,
  InlineIconEditing,
  EnterWritesHardBreak,
];

/** The "Insert icon" button's face: the catalog's sparkles. */
function SparkleGlyph(): ReactElement {
  const Icon = CMS_ICON_CATALOG.sparkles;
  return <Icon size={15} aria-hidden />;
}

/** T166: an inline icon's attributes as the dialog writes them; an unset size or offset is absent. */
export interface InlineIconChoice {
  name: CmsIconName;
  size?: string;
  offset?: number;
}

type IconSizeUnit = '' | 'em' | 'px';

/** The stored size as the dialog's unit and number (`''` for the text's own 1 em). */
function splitIconSize(size: unknown): { unit: IconSizeUnit; value: string } {
  if (!isInlineIconSize(size)) return { unit: '', value: '' };
  return size.endsWith('px') ? { unit: 'px', value: size.slice(0, -2) } : { unit: 'em', value: size.slice(0, -2) };
}

/** The dialog's unit and number as a stored size, brought into the grammar's range, or `undefined`. */
function joinIconSize(unit: IconSizeUnit, raw: string): string | undefined {
  if (unit === '' || raw.trim() === '') return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined;
  const [min, max] = unit === 'px' ? INLINE_ICON_SIZE_PX : INLINE_ICON_SIZE_EM;
  const clamped = Math.min(max, Math.max(min, parsed));
  const size = unit === 'px' ? `${Math.round(clamped)}px` : `${Math.round(clamped * 100) / 100}em`;
  return isInlineIconSize(size) ? size : undefined;
}

/** The dialog's offset as stored: em of the text, −1–1 in hundredths, or `undefined` when empty. */
function parseIconOffset(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined;
  const offset = Math.round(Math.min(INLINE_ICON_OFFSET_EM[1], Math.max(INLINE_ICON_OFFSET_EM[0], parsed)) * 100) / 100;
  return isInlineIconOffset(offset) ? offset : undefined;
}

const DIALOG_LABEL_CLASS = 'cmsc:mb-[4px] cmsc:block cmsc:text-[12px] cmsc:text-[#64748b]';
const DIALOG_INPUT_CLASS =
  'cmsc:box-border cmsc:w-full cmsc:rounded-[6px] cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:bg-white cmsc:px-[8px] cmsc:py-[7px] cmsc:text-[14px]';

/**
 * T163: the catalog's icons to pick from, searched by name. T166: with the
 * icon's size (the text's 1 em, em of the text or px) and vertical offset
 * (em of the text) above the grid. Picking an icon inserts it — or, editing a
 * selected icon, replaces it — with that size and offset; editing, **Apply**
 * keeps the icon and writes the size and offset alone.
 */
function IconInsertDialog({
  initial,
  onPick,
  onCancel,
}: {
  /** The selected icon's attributes, when the dialog edits one. */
  initial?: { name?: unknown; size?: unknown; offset?: unknown } | undefined;
  onPick: (choice: InlineIconChoice) => void;
  onCancel: () => void;
}): ReactElement {
  const text = useFieldText();
  const [query, setQuery] = useState('');
  const start = splitIconSize(initial?.size);
  const [unit, setUnit] = useState<IconSizeUnit>(start.unit);
  const [sizeValue, setSizeValue] = useState(start.value);
  const [offset, setOffset] = useState(isInlineIconOffset(initial?.offset) ? String(initial.offset) : '');
  const editing = typeof initial?.name === 'string' && resolveCmsIcon(initial.name) !== null;
  const title = text(editing ? 'inlineIcon.edit' : 'inlineIcon.insert');
  const names = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = Object.keys(CMS_ICON_CATALOG) as CmsIconName[];
    return q ? all.filter((name) => name.toLowerCase().includes(q) || humanizeIconName(name).toLowerCase().includes(q)) : all;
  }, [query]);
  const choice = (name: CmsIconName): InlineIconChoice => {
    const size = joinIconSize(unit, sizeValue);
    const shift = parseIconOffset(offset);
    return { name, ...(size !== undefined ? { size } : {}), ...(shift !== undefined ? { offset: shift } : {}) };
  };
  return (
    <CmsModalDialog title={title} onClose={onCancel}>
      <div className="cmsc:mb-[12px] cmsc:grid cmsc:grid-cols-2 cmsc:gap-[8px]">
        <label className="cmsc:block">
          <span className={DIALOG_LABEL_CLASS}>{text('inlineIcon.size')}</span>
          <select
            className={DIALOG_INPUT_CLASS}
            aria-label={text('inlineIcon.size')}
            value={unit}
            onChange={(event) => {
              const next = event.target.value as IconSizeUnit;
              setUnit(next);
              setSizeValue(next === 'px' ? '24' : next === 'em' ? '1' : '');
            }}
          >
            <option value="">{text('inlineIcon.size.text')}</option>
            <option value="em">{text('inlineIcon.size.em')}</option>
            <option value="px">{text('inlineIcon.size.px')}</option>
          </select>
        </label>
        {unit !== '' ? (
          <label className="cmsc:block">
            <span className={DIALOG_LABEL_CLASS}>{unit}</span>
            <input
              type="number"
              className={DIALOG_INPUT_CLASS}
              aria-label={text('inlineIcon.sizeValue')}
              min={unit === 'px' ? INLINE_ICON_SIZE_PX[0] : INLINE_ICON_SIZE_EM[0]}
              max={unit === 'px' ? INLINE_ICON_SIZE_PX[1] : INLINE_ICON_SIZE_EM[1]}
              step={unit === 'px' ? 1 : 0.05}
              value={sizeValue}
              onChange={(event) => setSizeValue(event.target.value)}
            />
          </label>
        ) : null}
        <label className="cmsc:col-span-2 cmsc:block">
          <span className={DIALOG_LABEL_CLASS}>{text('inlineIcon.offset')}</span>
          <input
            type="number"
            className={DIALOG_INPUT_CLASS}
            aria-label={text('inlineIcon.offset')}
            min={INLINE_ICON_OFFSET_EM[0]}
            max={INLINE_ICON_OFFSET_EM[1]}
            step={0.05}
            placeholder="-0.125"
            value={offset}
            onChange={(event) => setOffset(event.target.value)}
          />
          <span className="cmsc:mt-[4px] cmsc:block cmsc:text-[12px] cmsc:text-[#64748b]">{text('inlineIcon.offsetHint')}</span>
        </label>
      </div>
      <div className="cmsc-pb-icon-picker">
        <input
          type="search"
          className="cmsc-pb-icon-picker__search"
          placeholder={text('inlineIcon.searchPlaceholder')}
          aria-label={text('inlineIcon.search')}
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="cmsc-pb-icon-picker__grid" role="listbox" aria-label={text('inlineIcon.icons')}>
          {names.map((name) => {
            const Icon = CMS_ICON_CATALOG[name];
            const selected = editing && initial?.name === name;
            return (
              <button
                key={name}
                type="button"
                role="option"
                aria-selected={selected}
                aria-label={humanizeIconName(name)}
                title={humanizeIconName(name)}
                className={`cmsc-pb-icon-picker__item${selected ? ' cmsc-pb-icon-picker__item--active' : ''}`}
                onClick={() => onPick(choice(name))}
              >
                <Icon size={18} aria-hidden />
              </button>
            );
          })}
        </div>
        {names.length === 0 ? <p className="cmsc-pb-icon-picker__empty">{text('inlineIcon.noMatch', { query })}</p> : null}
      </div>
      <div className="cmsc:mt-[12px] cmsc:flex cmsc:justify-end cmsc:gap-[8px]">
        <button
          type="button"
          className="cmsc:font-sans cmsc:cursor-pointer cmsc:rounded-[6px] cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:bg-white cmsc:px-[12px] cmsc:py-[7px] cmsc:text-[13px] cmsc:text-[#334155]"
          onClick={onCancel}
        >
          {text('inlineIcon.cancel')}
        </button>
        {editing ? (
          <button
            type="button"
            className="cmsc:font-sans cmsc:cursor-pointer cmsc:rounded-[6px] cmsc:border cmsc:border-solid cmsc:border-[#15202b] cmsc:bg-[#15202b] cmsc:px-[12px] cmsc:py-[7px] cmsc:text-[13px] cmsc:text-white"
            onClick={() => onPick(choice((initial?.name ?? '') as CmsIconName))}
          >
            {text('inlineIcon.apply')}
          </button>
        ) : null}
      </div>
    </CmsModalDialog>
  );
}

/**
 * T175: the highlight colour of the selected phrase — a brand colour role
 * (stored `token:<role>`, drawn as the page draws it) or a hex typed or picked.
 * **Apply** is offered only for a colour of that grammar; **Remove colour**
 * takes the colour off and keeps the phrase's emphasis.
 */
function EmphasisColorDialog({
  initial,
  onApply,
  onRemove,
  onCancel,
}: {
  initial: string | undefined;
  onApply: (color: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}): ReactElement {
  const text = useFieldText();
  const [draft, setDraft] = useState(initial ?? '');
  const normalised = HEX_COLOR_RE.test(draft.trim()) ? draft.trim().toLowerCase() : draft.trim();
  const valid = emphasisColor(normalised) !== null;
  const title = text('emphasisColor.title');
  return (
    <CmsModalDialog title={title} onClose={onCancel} widthClassName="cmsc:max-w-[380px]">
      <span className={DIALOG_LABEL_CLASS}>{text('emphasisColor.brand')}</span>
      <div className="cmsc:mb-[12px] cmsc:flex cmsc:flex-wrap cmsc:gap-[6px]">
        {BRAND_COLOR_ROLES.map((entry) => {
          const label = text('emphasisColor.token', { role: entry.role });
          const selected = normalised === entry.value;
          return (
            <button
              key={entry.role}
              type="button"
              aria-label={label}
              title={label}
              aria-pressed={selected}
              className={`cmsc:h-[28px] cmsc:w-[28px] cmsc:cursor-pointer cmsc:rounded-full cmsc:border-2 cmsc:border-solid ${
                selected ? 'cmsc:border-[#15202b]' : 'cmsc:border-[#d9e0e7]'
              }`}
              style={{ background: `var(--cmsb-color-${entry.role}, ${entry.fallback})` }}
              onClick={() => setDraft(entry.value)}
            />
          );
        })}
      </div>
      <label className="cmsc:block">
        <span className={DIALOG_LABEL_CLASS}>{text('emphasisColor.custom')}</span>
        <span className="cmsc:flex cmsc:items-center cmsc:gap-[8px]">
          <NativeColorInput
            className="cmsc:h-[34px] cmsc:w-[40px] cmsc:shrink-0 cmsc:cursor-pointer cmsc:rounded-[6px] cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:p-[2px]"
            ariaLabel={text('emphasisColor.picker')}
            value={HEX_COLOR_RE.test(normalised) ? normalised : '#1261a6'}
            onCommit={(hex) => setDraft(hex.toLowerCase())}
          />
          <input
            type="text"
            className={DIALOG_INPUT_CLASS}
            aria-label={text('emphasisColor.custom')}
            placeholder="#1d4ed8"
            value={draft}
            aria-invalid={draft.trim() !== '' && !valid}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && valid) onApply(normalised);
            }}
          />
        </span>
      </label>
      <p className="cmsc:mt-[6px] cmsc:mb-0 cmsc:text-[12px] cmsc:text-[#64748b]">{text('emphasisColor.hint')}</p>
      <div className="cmsc:mt-[12px] cmsc:flex cmsc:justify-end cmsc:gap-[8px]">
        {initial !== undefined ? (
          <button
            type="button"
            className="cmsc:font-sans cmsc:mr-auto cmsc:cursor-pointer cmsc:rounded-[6px] cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:bg-white cmsc:px-[12px] cmsc:py-[7px] cmsc:text-[13px] cmsc:text-[#334155]"
            onClick={onRemove}
          >
            {text('emphasisColor.remove')}
          </button>
        ) : null}
        <button
          type="button"
          className="cmsc:font-sans cmsc:cursor-pointer cmsc:rounded-[6px] cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:bg-white cmsc:px-[12px] cmsc:py-[7px] cmsc:text-[13px] cmsc:text-[#334155]"
          onClick={onCancel}
        >
          {text('emphasisColor.cancel')}
        </button>
        <button
          type="button"
          disabled={!valid}
          className="cmsc:font-sans cmsc:cursor-pointer cmsc:rounded-[6px] cmsc:border cmsc:border-solid cmsc:border-[#15202b] cmsc:bg-[#15202b] cmsc:px-[12px] cmsc:py-[7px] cmsc:text-[13px] cmsc:text-white cmsc:disabled:cursor-not-allowed cmsc:disabled:opacity-40"
          onClick={() => onApply(normalised)}
        >
          {text('emphasisColor.apply')}
        </button>
      </div>
    </CmsModalDialog>
  );
}

/** A stored value as the editor's document: a legacy plain string is read as one paragraph. */
function toEditorDoc(value: InlineRichText | string | null | undefined): JSONContent {
  if (value === null || value === undefined) return plainTextToInlineRichText('') as JSONContent;
  if (typeof value === 'string') return plainTextToInlineRichText(value) as JSONContent;
  return value as JSONContent;
}

export interface InlineRichTextEditorProps {
  value: InlineRichText | string | null | undefined;
  onChange: (value: InlineRichText) => void;
  /** The accessible name of the editable region — the field's label. */
  label: string;
  readOnly?: boolean | undefined;
  /**
   * `field` (the default): the side-bar control, boxed, with its toolbar
   * always shown. `canvas`: in place on the page-builder canvas, in the block's
   * own typography, with the toolbar floating above it while it has focus.
   */
  variant?: 'field' | 'canvas';
}

const FIELD_TEXT_CLASS =
  'cmsc:font-sans cmsc:text-[14px] cmsc:leading-[1.5] cmsc:text-[#15202b] cmsc:outline-none cmsc:min-h-[22px] cmsc:[&_p]:m-0 cmsc:[&_a]:text-[#2563eb] cmsc:[&_a]:underline';
/** On the canvas the text keeps the block's look: only the paragraph margin goes. */
const CANVAS_TEXT_CLASS = 'cmsc-inline-canvas__text cmsc:outline-none cmsc:[&_p]:m-0';

/**
 * The editor of an `InlineRichText` prop: one line of text with bold, italic,
 * link, the three emphasis variants and their colour (T175), and Enter writing
 * a hard break.
 *
 * A legacy plain-string value is shown as text and is written back as a
 * document on the first edit; showing it writes nothing, so selecting a block
 * does not make the page dirty.
 */
export function InlineRichTextEditor({
  value,
  onChange,
  label,
  readOnly,
  variant = 'field',
}: InlineRichTextEditorProps): ReactElement {
  const [linkOpen, setLinkOpen] = useState(false);
  const [iconOpen, setIconOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  /** T166: the selected icon's attributes when the dialog was opened on one (it then edits that icon). */
  const [iconEditing, setIconEditing] = useState<Record<string, unknown> | undefined>(undefined);
  const text = useFieldText();
  const [focused, setFocused] = useState(false);
  const [, setTick] = useState(0);
  /** The value the editor was loaded with or last followed, and the last document it wrote. */
  const shown = useRef(value);
  const emitted = useRef<InlineRichText | null>(null);
  const editor = useEditor(
    {
      extensions: inlineRichTextExtensions,
      content: toEditorDoc(value),
      editable: !readOnly,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          role: 'textbox',
          'aria-label': label,
          'aria-multiline': 'false',
          class: variant === 'canvas' ? CANVAS_TEXT_CLASS : FIELD_TEXT_CLASS,
        },
      },
      onTransaction: () => setTick((tick) => tick + 1),
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
      onUpdate: ({ editor: activeEditor }) => {
        const json = activeEditor.getJSON() as unknown as InlineRichText;
        emitted.current = json;
        onChange(json);
      },
    },
    [],
  );

  // The same prop can be edited in two places — the side-bar field and the
  // canvas (feature 163). An editor that does not have focus follows a value
  // written elsewhere; the one being typed into is left alone.
  useEffect(() => {
    if (!editor || editor.isDestroyed || value === shown.current) return;
    shown.current = value;
    // Its own edit coming back, or one it is in the middle of.
    if (value === emitted.current || editor.isFocused) return;
    const next = toEditorDoc(value);
    if (JSON.stringify(editor.getJSON()) === JSON.stringify(next)) return;
    editor.commands.setContent(next, { emitUpdate: false });
  }, [editor, value]);

  if (readOnly) {
    return (
      <div className="cmsc:font-sans cmsc:text-[14px] cmsc:text-[#334155] cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:rounded-[8px] cmsc:bg-white cmsc:px-[10px] cmsc:py-[8px]">
        <InlineRich value={value} />
      </div>
    );
  }

  // #1652: on the canvas the toolbar hides once the text loses focus, so a cancelled
  // dialog hands focus back to the text there; in the side bar, to the toolbar button.
  const refocusTextOnCancel = variant === 'canvas';

  const linkDialog =
    linkOpen && editor ? (
      <LinkDialog
        initialUrl={(editor.getAttributes('link').href as string | undefined) ?? ''}
        initialBlank={(editor.getAttributes('link').target as string | undefined) === '_blank'}
        onCancel={() => {
          setLinkOpen(false);
          if (refocusTextOnCancel) editor.commands.focus();
        }}
        onApply={(url, openInNewTab) => {
          const range = editor.chain().focus().extendMarkRange('link');
          if (url.trim() === '') range.unsetLink().run();
          else
            range
              .setLink({
                href: url.trim(),
                target: openInNewTab ? '_blank' : null,
                rel: openInNewTab ? 'noopener noreferrer' : null,
              })
              .run();
          setLinkOpen(false);
        }}
      />
    ) : null;

  const iconDialog =
    iconOpen && editor ? (
      <IconInsertDialog
        initial={iconEditing}
        onCancel={() => {
          setIconOpen(false);
          if (refocusTextOnCancel) editor.commands.focus();
        }}
        onPick={(choice) => {
          if (iconEditing !== undefined && editor.isActive('inlineIcon')) {
            // T166: the selected icon takes the choice; an attribute left unset goes back to its default.
            editor
              .chain()
              .focus()
              .updateAttributes('inlineIcon', { name: choice.name, size: choice.size, offset: choice.offset })
              .run();
          } else {
            editor.chain().focus().insertContent({ type: 'inlineIcon', attrs: choice }).run();
          }
          setIconOpen(false);
        }}
      />
    ) : null;

  // T175: the selected phrase's emphasis colour, when it has one.
  const currentColor = editor ? emphasisColor((editor.getAttributes('emphasis') as { color?: unknown }).color)?.value : undefined;
  const colorDialog =
    colorOpen && editor ? (
      <EmphasisColorDialog
        initial={currentColor}
        onCancel={() => {
          setColorOpen(false);
          if (refocusTextOnCancel) editor.commands.focus();
        }}
        onApply={(color) => {
          editor.chain().focus().setEmphasisColor(color).run();
          setColorOpen(false);
        }}
        onRemove={() => {
          editor.chain().focus().setEmphasisColor(null).run();
          setColorOpen(false);
        }}
      />
    ) : null;

  const toolbarButtons = editor ? (
    <>
      <ToolbarButton title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
        <strong>B</strong>
      </ToolbarButton>
      <ToolbarButton title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton title="Link" active={editor.isActive('link')} onClick={() => setLinkOpen(true)}>
        🔗
      </ToolbarButton>
      <Divider />
      {EMPHASIS_VARIANTS.map((emphasis) => (
        <ToolbarButton
          key={emphasis}
          title={EMPHASIS_LABELS[emphasis]}
          active={editor.isActive('emphasis', { variant: emphasis })}
          onClick={() => editor.chain().focus().toggleEmphasis(emphasis).run()}
        >
          <span className={`cmsc-em cmsc-em--${emphasis}`}>A</span>
        </ToolbarButton>
      ))}
      <ToolbarButton title={text('emphasisColor.button')} active={currentColor !== undefined} onClick={() => setColorOpen(true)}>
        <span aria-hidden className="cmsc:inline-flex cmsc:flex-col cmsc:items-center cmsc:leading-none">
          A
          <span
            className="cmsc:mt-[2px] cmsc:block cmsc:h-[3px] cmsc:w-[14px] cmsc:rounded-[1px]"
            style={{ background: (currentColor !== undefined ? emphasisColor(currentColor)?.css : undefined) ?? 'conic-gradient(#1261a6, #0f766e, #f59e0b, #1261a6)' }}
          />
        </span>
      </ToolbarButton>
      <Divider />
      <ToolbarButton
        title={text(editor.isActive('inlineIcon') ? 'inlineIcon.edit' : 'inlineIcon.insert')}
        active={editor.isActive('inlineIcon')}
        onClick={() => {
          setIconEditing(editor.isActive('inlineIcon') ? { ...editor.getAttributes('inlineIcon') } : undefined);
          setIconOpen(true);
        }}
      >
        <SparkleGlyph />
      </ToolbarButton>
    </>
  ) : null;

  if (variant === 'canvas') {
    // In place on the canvas: the text in the block's own look, the toolbar
    // floating above it while the text has focus (or the link dialog is open).
    return (
      <div className="cmsc-inline-canvas cmsc:relative">
        {toolbarButtons && (focused || linkOpen || iconOpen || colorOpen) ? (
          <div
            role="toolbar"
            aria-label={label}
            className="cmsc-inline-canvas__toolbar cmsc:absolute cmsc:bottom-full cmsc:left-0 cmsc:z-[20] cmsc:mb-[4px] cmsc:flex cmsc:flex-wrap cmsc:items-center cmsc:gap-[3px] cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:rounded-[8px] cmsc:bg-[#f5f7fa] cmsc:px-[6px] cmsc:py-[5px] cmsc:shadow-sm"
          >
            {toolbarButtons}
          </div>
        ) : null}
        <EditorContent editor={editor} />
        {linkDialog}
        {iconDialog}
        {colorDialog}
      </div>
    );
  }

  return (
    <div className="cmsc:flex cmsc:flex-col">
      {toolbarButtons ? (
        <div
          role="toolbar"
          aria-label={label}
          className="cmsc:flex cmsc:flex-wrap cmsc:items-center cmsc:gap-[3px] cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:rounded-t-[8px] cmsc:bg-[#f5f7fa] cmsc:px-[6px] cmsc:py-[5px]"
        >
          {toolbarButtons}
        </div>
      ) : null}
      <div className="cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:border-t-0 cmsc:rounded-b-[8px] cmsc:bg-white cmsc:px-[10px] cmsc:py-[8px]">
        <EditorContent editor={editor} />
      </div>
      {linkDialog}
      {iconDialog}
      {colorDialog}
    </div>
  );
}
