'use client';

import { type Editor, type JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { useId, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  EMPHASIS_VARIANTS,
  normalizeAnchor,
  PAGE_BUILDER_FIELD_TEXT,
  useContentDefault,
  useFieldText,
  useImagePicker,
  type EmphasisVariant,
} from '@endora-commerce/page-builder-core';
import {
  LIST_MARKERS,
  READ_MORE_POSITIONS,
  TEXT_SIZE_TOKENS,
  RICH_CONTENT_PROSE_CLASS,
  RICH_IMAGE_ALIGNS,
  RICH_IMAGE_SIZE_RE,
  type RichImageAlign,
  defaultRichContent,
  htmlFromTiptap,
  readMoreContent,
  richContentExtensions,
  sanitizeRichHtml,
} from './rich-content-shared.js';
import { CmsModalDialog } from './CmsModalDialog.js';

/**
 * What a link can be shown as (R-14): a plain link, or a button in one of the
 * button styles (`cmsc-btn--<style>-<fill>`). Each is named by the field text
 * `richLink.display.<style>` (#1680); a plain link stores no variant.
 */
export const LINK_DISPLAY_VARIANTS = [
  'primary-solid',
  'primary-outline',
  'secondary-solid',
  'secondary-outline',
  'dark-solid',
  'light-solid',
] as const;

/**
 * @deprecated The English names only, kept for importers of this subpath; the
 * toolbars read `emphasis.<variant>` through {@link useFieldText} (#1680).
 */
export const EMPHASIS_LABELS: Record<EmphasisVariant, string> = {
  gradient: PAGE_BUILDER_FIELD_TEXT['emphasis.gradient'],
  accent: PAGE_BUILDER_FIELD_TEXT['emphasis.accent'],
  muted: PAGE_BUILDER_FIELD_TEXT['emphasis.muted'],
};

/**
 * @deprecated The English names only, kept for importers of this subpath; the
 * toolbar names each choice by `richLink.display.<style>` through
 * {@link useFieldText} (#1680).
 */
export const LINK_DISPLAY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: PAGE_BUILDER_FIELD_TEXT['richLink.display.link'] },
  ...LINK_DISPLAY_VARIANTS.map((value) => ({ value, label: PAGE_BUILDER_FIELD_TEXT[`richLink.display.${value}`] })),
];

export function ToolbarButton({
  children,
  title,
  active,
  disabled,
  onClick,
  ref,
}: {
  children: ReactNode;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  ref?: Ref<HTMLButtonElement> | undefined;
}) {
  return (
    <button
      ref={ref}
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active ?? false}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      className={`cmsc:font-sans cmsc:inline-flex cmsc:items-center cmsc:justify-center cmsc:min-w-[30px] cmsc:h-[30px] cmsc:px-[7px] cmsc:text-[13px] cmsc:leading-none cmsc:rounded-[6px] cmsc:border cmsc:border-solid cmsc:transition-colors ${
        active
          ? 'cmsc:bg-[#15202b] cmsc:text-white cmsc:border-[#15202b]'
          : 'cmsc:bg-white cmsc:text-[#334155] cmsc:border-transparent cmsc:hover:bg-[#e8edf2]'
      } ${disabled ? 'cmsc:opacity-35 cmsc:cursor-not-allowed' : 'cmsc:cursor-pointer'}`}
    >
      {children}
    </button>
  );
}

export function Divider() {
  return <span className="cmsc:self-stretch cmsc:w-px cmsc:my-[3px] cmsc:bg-[#d9e0e7]" />;
}

/** The block types, each named by the field text `richText.block.<value>` (#1680). */
const BLOCK_OPTIONS = ['p', 'h1', 'h2', 'h3', 'h4'] as const;

/** A translated word set into markup: the host's copy is text, never HTML. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function currentBlock(editor: Editor): string {
  for (const level of [1, 2, 3, 4] as const) {
    if (editor.isActive('heading', { level })) return `h${level}`;
  }
  return 'p';
}

export function LinkDialog({
  initialUrl,
  initialBlank,
  initialVariant,
  displayOptions,
  onApply,
  onCancel,
}: {
  initialUrl: string;
  initialBlank: boolean;
  /** The link's button style, when `displayOptions` offers a choice. */
  initialVariant?: string | null | undefined;
  /** What the link can be shown as; no choice is offered without it. */
  displayOptions?: ReadonlyArray<{ value: string; label: string }> | undefined;
  onApply: (url: string, openInNewTab: boolean, variant: string | null) => void;
  onCancel: () => void;
}) {
  const text = useFieldText();
  const [url, setUrl] = useState(initialUrl);
  const [openInNewTab, setOpenInNewTab] = useState(initialBlank);
  const [variant, setVariant] = useState(initialVariant ?? '');
  const apply = () => onApply(url, openInNewTab, variant === '' ? null : variant);

  return (
    <CmsModalDialog title={text('richLink.title')} onClose={onCancel}>
      <label className="cmsc:block cmsc:mb-[10px]">
        <span className="cmsc:mb-[4px] cmsc:block cmsc:text-[12px] cmsc:text-[#64748b]">{text('richLink.url')}</span>
        <input
          className="cmsc:box-border cmsc:w-full cmsc:rounded-[6px] cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:px-[10px] cmsc:py-[8px] cmsc:text-[14px]"
          value={url}
          placeholder="https://…"
          autoFocus
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') apply();
          }}
        />
      </label>
      {displayOptions ? (
        <label className="cmsc:block cmsc:mb-[10px]">
          <span className="cmsc:mb-[4px] cmsc:block cmsc:text-[12px] cmsc:text-[#64748b]">{text('richLink.showAs')}</span>
          <select
            className="cmsc:box-border cmsc:w-full cmsc:rounded-[6px] cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:bg-white cmsc:px-[8px] cmsc:py-[7px] cmsc:text-[14px]"
            value={variant}
            onChange={(event) => setVariant(event.target.value)}
          >
            {displayOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="cmsc:mb-[14px] cmsc:flex cmsc:items-center cmsc:gap-[8px] cmsc:text-[13px] cmsc:text-[#334155]">
        <input
          type="checkbox"
          checked={openInNewTab}
          onChange={(event) => setOpenInNewTab(event.target.checked)}
        />
        {text('richLink.newTab')}
      </label>
      <div className="cmsc:flex cmsc:justify-end cmsc:gap-[8px]">
        <button
          type="button"
          className="cmsc:cursor-pointer cmsc:rounded-[6px] cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:bg-white cmsc:px-[12px] cmsc:py-[7px] cmsc:text-[13px]"
          onClick={onCancel}
        >
          {text('richLink.cancel')}
        </button>
        <button
          type="button"
          className="cmsc:cursor-pointer cmsc:rounded-[6px] cmsc:border cmsc:border-solid cmsc:border-[#15202b] cmsc:bg-[#15202b] cmsc:px-[12px] cmsc:py-[7px] cmsc:text-[13px] cmsc:text-white"
          onClick={apply}
        >
          {url.trim() ? text('richLink.apply') : text('richLink.remove')}
        </button>
      </div>
    </CmsModalDialog>
  );
}

/**
 * A heading's anchor (R-14): what the editor types is shown normalised as they
 * type (R-8's pattern), and an empty value removes the anchor. Uniqueness on
 * the page is checked when the page is saved (`CMS_DUPLICATE_ANCHOR`).
 */
export function AnchorDialog({
  initialAnchor,
  onApply,
  onCancel,
}: {
  initialAnchor: string;
  onApply: (anchor: string | null) => void;
  onCancel: () => void;
}) {
  const text = useFieldText();
  const [raw, setRaw] = useState(initialAnchor);
  const previewId = useId();
  const anchor = normalizeAnchor(raw);
  const apply = () => onApply(anchor === '' ? null : anchor);

  return (
    <CmsModalDialog title={text('richAnchor.title')} onClose={onCancel}>
      <label className="cmsc:block cmsc:mb-[6px]">
        <span className="cmsc:mb-[4px] cmsc:block cmsc:text-[12px] cmsc:text-[#64748b]">{text('richAnchor.label')}</span>
        <input
          className="cmsc:box-border cmsc:w-full cmsc:rounded-[6px] cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:px-[10px] cmsc:py-[8px] cmsc:text-[14px]"
          value={raw}
          placeholder={text('richAnchor.placeholder')}
          autoFocus
          aria-describedby={previewId}
          onChange={(event) => setRaw(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') apply();
          }}
        />
      </label>
      <p id={previewId} className="cmsc:m-0 cmsc:mb-[14px] cmsc:text-[12px] cmsc:text-[#64748b]" aria-live="polite">
        {anchor === '' ? text('richAnchor.none') : text('richAnchor.hint', { anchor })}
      </p>
      <div className="cmsc:flex cmsc:justify-end cmsc:gap-[8px]">
        <button
          type="button"
          className="cmsc:cursor-pointer cmsc:rounded-[6px] cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:bg-white cmsc:px-[12px] cmsc:py-[7px] cmsc:text-[13px]"
          onClick={onCancel}
        >
          {text('richAnchor.cancel')}
        </button>
        <button
          type="button"
          className="cmsc:cursor-pointer cmsc:rounded-[6px] cmsc:border cmsc:border-solid cmsc:border-[#15202b] cmsc:bg-[#15202b] cmsc:px-[12px] cmsc:py-[7px] cmsc:text-[13px] cmsc:text-white"
          onClick={apply}
        >
          {anchor === '' ? text('richAnchor.remove') : text('richAnchor.apply')}
        </button>
      </div>
    </CmsModalDialog>
  );
}

/** What the image dialog hands back (T128): the image, its width with its unit, its alignment, and the inline mode. */
export interface RichImageChoice {
  src: string;
  alt: string;
  /** `'240px'`, `'50%'`, or `null` for the image's own width. */
  size: string | null;
  /** Left, center or right for an image on its own line; `null` for none or an inline image. */
  align: RichImageAlign | null;
  /** In the line of text (an `inlineImage` node) rather than on its own line. */
  inline: boolean;
}

/** A dialog control's look, without a width: the full-width controls add `cmsc:w-full`, the width's unit a fixed one (T195). */
const DIALOG_CONTROL_CLASS =
  'cmsc:box-border cmsc:rounded-[6px] cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:px-[10px] cmsc:py-[8px] cmsc:text-[14px]';
const DIALOG_INPUT_CLASS = `${DIALOG_CONTROL_CLASS} cmsc:w-full`;
const DIALOG_LABEL_CLASS = 'cmsc:mb-[4px] cmsc:block cmsc:text-[12px] cmsc:text-[#475569]';

function splitSize(size: string | null | undefined): { amount: string; unit: 'px' | '%' } {
  const match = /^(\d+)(px|%)$/.exec(size ?? '');
  return match ? { amount: match[1]!, unit: match[2] as 'px' | '%' } : { amount: '', unit: 'px' };
}

/**
 * Inserts an image, or edits the selected one (T128): its address and
 * alternative text, a width in px or %, an alignment (left, center, right) and
 * whether it sits in the line of text. A width that is not a whole number in
 * range is not written; an inline image takes no alignment.
 *
 * T195: where the host provides an image picker (the admin's asset library,
 * {@link useImagePicker}), the image comes from the library or a URL — the
 * library first for a new image, the URL for an existing one; the chosen
 * image's address is inserted, and its alternative text when the field is
 * empty. Without a picker, a URL.
 */
export function ImageDialog({
  initial,
  onApply,
  onCancel,
}: {
  /** The selected image's values, when editing one. */
  initial?: Partial<RichImageChoice> | undefined;
  onApply: (choice: RichImageChoice) => void;
  onCancel: () => void;
}) {
  const start = splitSize(initial?.size);
  const [url, setUrl] = useState(initial?.src ?? '');
  const [alt, setAlt] = useState(initial?.alt ?? '');
  const [amount, setAmount] = useState(start.amount);
  const [unit, setUnit] = useState<'px' | '%'>(start.unit);
  const [align, setAlign] = useState<string>(initial?.align ?? '');
  const [inline, setInline] = useState(initial?.inline === true);
  const editing = initial?.src !== undefined && initial.src !== '';
  const Picker = useImagePicker();
  const text = useFieldText();
  const [source, setSource] = useState<'library' | 'url'>(Picker !== null && !editing ? 'library' : 'url');
  const [picking, setPicking] = useState(false);
  const fromLibrary = Picker !== null && source === 'library';

  const apply = () => {
    const candidate = amount.trim() === '' ? null : `${amount.trim()}${unit}`;
    onApply({
      src: url.trim(),
      alt: alt.trim(),
      size: candidate !== null && RICH_IMAGE_SIZE_RE.test(candidate) ? candidate : null,
      align: !inline && (RICH_IMAGE_ALIGNS as readonly string[]).includes(align) ? (align as RichImageAlign) : null,
      inline,
    });
  };

  return (
    <CmsModalDialog title={text(editing ? 'richImage.edit' : 'richImage.insert')} onClose={onCancel}>
      {Picker !== null ? (
        <label className="cmsc:block cmsc:mb-[10px]">
          <span className={DIALOG_LABEL_CLASS}>{text('richImage.source')}</span>
          <select
            aria-label={text('richImage.source')}
            className={DIALOG_INPUT_CLASS}
            value={source}
            onChange={(event) => setSource(event.target.value as 'library' | 'url')}
          >
            <option value="library">{text('richImage.source.library')}</option>
            <option value="url">{text('richImage.source.url')}</option>
          </select>
        </label>
      ) : null}
      {fromLibrary ? (
        <div className="cmsc:mb-[10px] cmsc:flex cmsc:items-center cmsc:gap-[10px]">
          {url.trim() ? (
            <img
              data-role="preview"
              src={url.trim()}
              alt={text('richImage.preview')}
              className="cmsc:h-[56px] cmsc:w-[56px] cmsc:flex-none cmsc:rounded-[6px] cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:object-contain"
            />
          ) : null}
          <button
            type="button"
            data-action="choose"
            autoFocus
            className="cmsc:cursor-pointer cmsc:rounded-[6px] cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:bg-white cmsc:px-[12px] cmsc:py-[7px] cmsc:text-[13px]"
            onClick={() => setPicking(true)}
          >
            {url.trim() ? text('richImage.change') : text('richImage.choose')}
          </button>
        </div>
      ) : (
        <label className="cmsc:block cmsc:mb-[10px]">
          <span className={DIALOG_LABEL_CLASS}>{text('richImage.url')}</span>
          <input
            className={DIALOG_INPUT_CLASS}
            value={url}
            placeholder="https://…"
            autoFocus
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
      )}
      <label className="cmsc:block cmsc:mb-[10px]">
        <span className={DIALOG_LABEL_CLASS}>{text('richImage.alt')}</span>
        <input className={DIALOG_INPUT_CLASS} value={alt} onChange={(event) => setAlt(event.target.value)} />
      </label>
      <div className="cmsc:mb-[10px] cmsc:flex cmsc:items-end cmsc:gap-[8px]">
        <label className="cmsc:block cmsc:min-w-0 cmsc:flex-1">
          <span className={DIALOG_LABEL_CLASS}>{text('richImage.width')}</span>
          <input
            className={DIALOG_INPUT_CLASS}
            type="number"
            min={1}
            max={unit === '%' ? 100 : 9999}
            inputMode="numeric"
            placeholder={text('richImage.widthAuto')}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <select
          aria-label={text('richImage.widthUnit')}
          className={`${DIALOG_CONTROL_CLASS} cmsc:w-[76px] cmsc:flex-none`}
          value={unit}
          onChange={(event) => setUnit(event.target.value as 'px' | '%')}
        >
          <option value="px">px</option>
          <option value="%">%</option>
        </select>
      </div>
      <label className="cmsc:block cmsc:mb-[10px]">
        <span className={DIALOG_LABEL_CLASS}>{text('richImage.align')}</span>
        <select
          className={DIALOG_INPUT_CLASS}
          value={inline ? '' : align}
          disabled={inline}
          onChange={(event) => setAlign(event.target.value)}
        >
          <option value="">{text('richImage.align.default')}</option>
          {RICH_IMAGE_ALIGNS.map((option) => (
            <option key={option} value={option}>
              {text(`richImage.align.${option}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="cmsc:mb-[14px] cmsc:flex cmsc:min-h-[24px] cmsc:items-center cmsc:gap-[8px] cmsc:text-[13px] cmsc:text-[#334155]">
        <input type="checkbox" checked={inline} onChange={(event) => setInline(event.target.checked)} />
        {text('richImage.inline')}
      </label>
      <div className="cmsc:flex cmsc:justify-end cmsc:gap-[8px]">
        <button
          type="button"
          className="cmsc:cursor-pointer cmsc:rounded-[6px] cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:bg-white cmsc:px-[12px] cmsc:py-[7px] cmsc:text-[13px]"
          onClick={onCancel}
        >
          {text('richImage.cancel')}
        </button>
        <button
          type="button"
          data-action="apply"
          className="cmsc:cursor-pointer cmsc:rounded-[6px] cmsc:border cmsc:border-solid cmsc:border-[#15202b] cmsc:bg-[#15202b] cmsc:px-[12px] cmsc:py-[7px] cmsc:text-[13px] cmsc:text-white disabled:cmsc:opacity-40"
          disabled={!url.trim()}
          onClick={apply}
        >
          {editing ? text('richImage.apply') : text('richImage.insertAction')}
        </button>
      </div>
      {Picker !== null && picking ? (
        <Picker
          onClose={() => setPicking(false)}
          onPick={(image) => {
            setUrl(image.url);
            if (image.alt && alt.trim() === '') setAlt(image.alt);
            setPicking(false);
          }}
        />
      ) : null}
    </CmsModalDialog>
  );
}

/** The selected image's values, when the selection is an image of either kind. */
function selectedImage(editor: Editor): Partial<RichImageChoice> | undefined {
  for (const type of ['image', 'inlineImage'] as const) {
    if (!editor.isActive(type)) continue;
    const attrs = editor.getAttributes(type) as { src?: string; alt?: string; size?: string | null; align?: RichImageAlign | null };
    return {
      src: attrs.src ?? '',
      alt: attrs.alt ?? '',
      size: attrs.size ?? null,
      align: attrs.align ?? null,
      inline: type === 'inlineImage',
    };
  }
  return undefined;
}

/** Inserts the image, or replaces the selected one (its kind may change from block to inline). */
function applyImage(editor: Editor, choice: RichImageChoice, replacing: boolean): void {
  const node = choice.inline
    ? { type: 'inlineImage', attrs: { src: choice.src, alt: choice.alt, size: choice.size } }
    : { type: 'image', attrs: { src: choice.src, alt: choice.alt, size: choice.size, align: choice.align } };
  const chain = editor.chain().focus();
  if (replacing) chain.deleteSelection();
  chain.insertContent(node).run();
}

function Toolbar({
  editor,
  expanded,
  onToggleExpand,
  expandButtonRef,
  toolbarExtra,
}: {
  editor: Editor | null;
  expanded: boolean;
  onToggleExpand: () => void;
  /** The full-screen toggle, where focus returns when full screen closes (#1652). */
  expandButtonRef?: Ref<HTMLButtonElement> | undefined;
  toolbarExtra?: ReactNode | ((editor: Editor) => ReactNode);
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [anchorOpen, setAnchorOpen] = useState(false);
  const text = useFieldText();
  // Content seeded into the document is in the edited content locale (#1684), not the admin's.
  const contentDefault = useContentDefault();

  if (!editor) return null;

  // T173: the read-more passage around the caret — its summary's position and the reveal above.
  const inReadMore = editor.isActive('readMore');
  const readMoreAttrs = editor.getAttributes('readMore') as { chevronPosition?: string; revealAbove?: boolean };
  const readMorePosition = inReadMore && (READ_MORE_POSITIONS as readonly string[]).includes(readMoreAttrs.chevronPosition ?? '') ? readMoreAttrs.chevronPosition! : 'start';

  const inHeading = editor.isActive('heading');
  const headingAttrs = editor.getAttributes('heading') as { anchor?: string | null; srOnly?: boolean };
  const toggleCheckList = () => {
    const chain = editor.chain().focus();
    if (editor.isActive('bulletList', { listStyle: 'check' })) chain.updateAttributes('bulletList', { listStyle: null }).run();
    else if (editor.isActive('bulletList')) chain.updateAttributes('bulletList', { listStyle: 'check' }).run();
    else chain.toggleBulletList().updateAttributes('bulletList', { listStyle: 'check' }).run();
  };

  const extra =
    typeof toolbarExtra === 'function' ? toolbarExtra(editor) : toolbarExtra;

  const applyBlock = (value: string) => {
    const chain = editor.chain().focus();
    if (value === 'p') chain.setParagraph().run();
    else chain.setNode('heading', { level: Number(value.slice(1)) }).run();
  };

  // R19A (T233): the bullet list's marker around the caret, and the run's text size.
  const inBulletList = editor.isActive('bulletList');
  const listStyle = editor.getAttributes('bulletList').listStyle as unknown;
  const listMarker = inBulletList && (LIST_MARKERS as readonly unknown[]).includes(listStyle) ? (listStyle as string) : 'disc';
  const runSize = editor.getAttributes('textSize').size as unknown;
  // R23 (T442): a type token only; a Custom px stored by R19A shows as Default until a token replaces it.
  const sizeToken = typeof runSize === 'string' && (TEXT_SIZE_TOKENS as readonly string[]).includes(runSize) ? runSize : '';
  const applyTextSize = (value: string) => {
    if (value === '') editor.chain().focus().unsetTextSize().run();
    else editor.chain().focus().setTextSize(value).run();
  };

  const textColor = (editor.getAttributes('textStyle').color as string | undefined) ?? '#243447';
  const highlightColor =
    (editor.getAttributes('highlight').color as string | undefined) ?? '#fef08c';

  return (
    <>
      <div className="cmsc:flex cmsc:flex-wrap cmsc:items-center cmsc:gap-[3px] cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:rounded-t-[8px] cmsc:bg-[#f5f7fa] cmsc:px-[6px] cmsc:py-[5px]">
        <select
          value={currentBlock(editor)}
          onChange={(event) => applyBlock(event.target.value)}
          title={text('richText.blockType')}
          aria-label={text('richText.blockType')}
          className="cmsc:font-sans cmsc:h-[30px] cmsc:text-[13px] cmsc:text-[#334155] cmsc:bg-white cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:rounded-[6px] cmsc:px-[6px] cmsc:cursor-pointer"
        >
          {BLOCK_OPTIONS.map((block) => (
            <option key={block} value={block}>
              {text(`richText.block.${block}`)}
            </option>
          ))}
        </select>

        <Divider />

        <ToolbarButton title={text('richText.bold')} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
          <strong>B</strong>
        </ToolbarButton>
        <ToolbarButton title={text('richText.italic')} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <em>I</em>
        </ToolbarButton>
        <ToolbarButton title={text('richText.underline')} active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <span className="cmsc:underline">U</span>
        </ToolbarButton>
        <ToolbarButton title={text('richText.strike')} active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <span className="cmsc:line-through">S</span>
        </ToolbarButton>
        <ToolbarButton title={text('richText.code')} active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>
          {'</>'}
        </ToolbarButton>
        <ToolbarButton title={text('richText.link')} active={editor.isActive('link')} onClick={() => setLinkOpen(true)}>
          🔗
        </ToolbarButton>
        <ToolbarButton
          title={text(selectedImage(editor) ? 'richImage.edit' : 'richImage.insert')}
          active={selectedImage(editor) !== undefined}
          onClick={() => setImageOpen(true)}
        >
          🖼
        </ToolbarButton>
        {EMPHASIS_VARIANTS.map((variant) => (
          <ToolbarButton
            key={variant}
            title={text(`emphasis.${variant}`)}
            active={editor.isActive('emphasis', { variant })}
            onClick={() => editor.chain().focus().toggleEmphasis(variant).run()}
          >
            <span className={`cmsc-em cmsc-em--${variant}`}>A</span>
          </ToolbarButton>
        ))}

        <Divider />

        <ToolbarButton title={text('richText.anchor')} active={Boolean(headingAttrs.anchor)} disabled={!inHeading} onClick={() => setAnchorOpen(true)}>
          #
        </ToolbarButton>
        <ToolbarButton
          title={text('richText.srOnly')}
          active={inHeading && headingAttrs.srOnly === true}
          disabled={!inHeading}
          onClick={() => editor.chain().focus().updateAttributes('heading', { srOnly: headingAttrs.srOnly !== true }).run()}
        >
          👁
        </ToolbarButton>

        <Divider />

        <select
          value={sizeToken}
          title={text('textSize')}
          aria-label={text('textSize')}
          onChange={(event) => applyTextSize(event.target.value)}
          className="cmsc:font-sans cmsc:h-[30px] cmsc:text-[13px] cmsc:text-[#334155] cmsc:bg-white cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:rounded-[6px] cmsc:px-[6px] cmsc:cursor-pointer"
        >
          <option value="">{text('textSize.default')}</option>
          {TEXT_SIZE_TOKENS.map((token) => (
            <option key={token} value={token}>
              {text(`textSize.${token}`)}
            </option>
          ))}
        </select>
        <label
          title={text('richText.textColor')}
          className="cmsc:inline-flex cmsc:h-[30px] cmsc:items-center cmsc:gap-[4px] cmsc:rounded-[6px] cmsc:px-[4px] cmsc:text-[12px] cmsc:text-[#64748b]"
        >
          A
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(textColor) ? textColor : '#243447'}
            className="cmsc:h-[22px] cmsc:w-[28px] cmsc:cursor-pointer cmsc:border-0 cmsc:bg-transparent cmsc:p-0"
            onChange={(event) => editor.chain().focus().setColor(event.target.value).run()}
          />
        </label>
        <label
          title={text('richText.highlightColor')}
          className="cmsc:inline-flex cmsc:h-[30px] cmsc:items-center cmsc:gap-[4px] cmsc:rounded-[6px] cmsc:px-[4px] cmsc:text-[12px] cmsc:text-[#64748b]"
        >
          ▮
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(highlightColor) ? highlightColor : '#fef08c'}
            className="cmsc:h-[22px] cmsc:w-[28px] cmsc:cursor-pointer cmsc:border-0 cmsc:bg-transparent cmsc:p-0"
            onChange={(event) =>
              editor.chain().focus().toggleHighlight({ color: event.target.value }).run()
            }
          />
        </label>

        <Divider />

        <ToolbarButton title={text('richText.bulletList')} active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          •—
        </ToolbarButton>
        <ToolbarButton title={text('richText.checkList')} active={editor.isActive('bulletList', { listStyle: 'check' })} onClick={toggleCheckList}>
          ✓
        </ToolbarButton>
        <select
          value={listMarker}
          disabled={!inBulletList}
          title={text('listMarker')}
          aria-label={text('listMarker')}
          onChange={(event) =>
            editor
              .chain()
              .focus()
              .updateAttributes('bulletList', { listStyle: event.target.value === 'disc' ? null : event.target.value })
              .run()
          }
          className="cmsc:font-sans cmsc:h-[30px] cmsc:text-[13px] cmsc:text-[#334155] cmsc:bg-white cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:rounded-[6px] cmsc:px-[6px] cmsc:cursor-pointer cmsc:disabled:cursor-not-allowed cmsc:disabled:opacity-35"
        >
          {(['disc', ...LIST_MARKERS] as const).map((marker) => (
            <option key={marker} value={marker}>
              {text(`listMarker.${marker}`)}
            </option>
          ))}
        </select>
        <ToolbarButton title={text('richText.orderedList')} active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          1.
        </ToolbarButton>
        <ToolbarButton
          title={text('richText.readMore')}
          active={editor.isActive('readMore')}
          onClick={() => editor.chain().focus().insertContent(readMoreContent(contentDefault('readMore.summary'))).run()}
        >
          ⋯
        </ToolbarButton>
        <ToolbarButton
          title={text('richText.readMoreChevron')}
          active={editor.isActive('readMore', { summaryStyle: 'chevron' })}
          disabled={!editor.isActive('readMore')}
          onClick={() =>
            editor
              .chain()
              .focus()
              .updateAttributes('readMore', {
                summaryStyle: editor.isActive('readMore', { summaryStyle: 'chevron' }) ? 'text' : 'chevron',
              })
              .run()
          }
        >
          ⌄
        </ToolbarButton>
        <select
          value={readMorePosition}
          disabled={!inReadMore}
          title={text('readMore.position')}
          aria-label={text('readMore.position')}
          onChange={(event) => editor.chain().focus().updateAttributes('readMore', { chevronPosition: event.target.value }).run()}
          className="cmsc:font-sans cmsc:h-[30px] cmsc:text-[13px] cmsc:text-[#334155] cmsc:bg-white cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:rounded-[6px] cmsc:px-[6px] cmsc:cursor-pointer cmsc:disabled:cursor-not-allowed cmsc:disabled:opacity-35"
        >
          {READ_MORE_POSITIONS.map((position) => (
            <option key={position} value={position}>
              {text(`readMore.position.${position}`)}
            </option>
          ))}
        </select>
        <ToolbarButton
          title={text('readMore.revealAbove')}
          active={inReadMore && readMoreAttrs.revealAbove === true}
          disabled={!inReadMore}
          onClick={() => editor.chain().focus().updateAttributes('readMore', { revealAbove: readMoreAttrs.revealAbove !== true }).run()}
        >
          ⤒
        </ToolbarButton>
        <ToolbarButton title={text('richText.quote')} active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          ❝
        </ToolbarButton>
        <ToolbarButton title={text('richText.codeBlock')} active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
          {'{ }'}
        </ToolbarButton>
        <ToolbarButton title={text('richText.horizontalRule')} onClick={() => editor.chain().focus().setHorizontalRule().run()}>
          ―
        </ToolbarButton>

        <Divider />

        <ToolbarButton title={text('richText.alignLeft')} active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}>
          ⫷
        </ToolbarButton>
        <ToolbarButton title={text('richText.alignCenter')} active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}>
          ☰
        </ToolbarButton>
        <ToolbarButton title={text('richText.alignRight')} active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}>
          ⫸
        </ToolbarButton>
        <ToolbarButton title={text('richText.justify')} active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()}>
          ▤
        </ToolbarButton>

        <Divider />

        <ToolbarButton title={text('richText.clearFormatting')} onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
          ⌫
        </ToolbarButton>
        <ToolbarButton title={text('richText.undo')} disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
          ↶
        </ToolbarButton>
        <ToolbarButton title={text('richText.redo')} disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
          ↷
        </ToolbarButton>

        {extra ? (
          <>
            <Divider />
            <span className="cmsc:inline-flex cmsc:items-center cmsc:gap-[4px]">{extra}</span>
          </>
        ) : null}

        <span className="cmsc:ml-auto" />
        <ToolbarButton
          ref={expandButtonRef}
          title={text(expanded ? 'richText.collapse' : 'richText.expand')}
          active={expanded}
          onClick={onToggleExpand}
        >
          {expanded ? '🗗' : '⤢'}
        </ToolbarButton>
      </div>

      {linkOpen ? (
        <LinkDialog
          initialUrl={(editor.getAttributes('link').href as string | undefined) ?? ''}
          initialBlank={(editor.getAttributes('link').target as string | undefined) === '_blank'}
          initialVariant={(editor.getAttributes('link').variant as string | null | undefined) ?? null}
          displayOptions={[
            { value: '', label: text('richLink.display.link') },
            ...LINK_DISPLAY_VARIANTS.map((value) => ({ value, label: text(`richLink.display.${value}`) })),
          ]}
          onCancel={() => setLinkOpen(false)}
          onApply={(url, openInNewTab, variant) => {
            const range = editor.chain().focus().extendMarkRange('link');
            if (url.trim() === '') range.unsetLink().run();
            else
              range
                .setLink({
                  href: url.trim(),
                  target: openInNewTab ? '_blank' : null,
                  rel: openInNewTab ? 'noopener noreferrer' : null,
                })
                .updateAttributes('link', { variant })
                .run();
            setLinkOpen(false);
          }}
        />
      ) : null}

      {anchorOpen ? (
        <AnchorDialog
          initialAnchor={headingAttrs.anchor ?? ''}
          onCancel={() => setAnchorOpen(false)}
          onApply={(anchor) => {
            editor.chain().focus().updateAttributes('heading', { anchor }).run();
            setAnchorOpen(false);
          }}
        />
      ) : null}

      {imageOpen ? (
        <ImageDialog
          initial={selectedImage(editor)}
          onCancel={() => setImageOpen(false)}
          onApply={(choice) => {
            applyImage(editor, choice, selectedImage(editor) !== undefined);
            setImageOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

export function RichContentEditorField({
  value,
  onChange,
  readOnly,
  toolbarExtra,
}: {
  value: JSONContent | null;
  onChange: (value: JSONContent | null) => void;
  readOnly?: boolean | undefined;
  /** Optional controls appended to the CMS TipTap toolbar (e.g. email Variable). */
  toolbarExtra?: ReactNode | ((editor: Editor) => ReactNode);
}) {
  const [expanded, setExpanded] = useState(false);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const text = useFieldText();
  const [, setTick] = useState(0);
  const editor = useEditor(
    {
      extensions: richContentExtensions,
      content: value ?? defaultRichContent,
      editable: !readOnly,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: `cmsc-rich-editor ${RICH_CONTENT_PROSE_CLASS} cmsc:outline-none cmsc:min-h-[140px] cmsc:[&_p]:my-[8px] cmsc:[&_h1]:my-[8px] cmsc:[&_h2]:my-[8px] cmsc:[&_h3]:my-[8px] cmsc:[&_h4]:my-[8px] cmsc:[&_ul]:my-[8px] cmsc:[&_ol]:my-[8px] cmsc:[&_blockquote]:my-[8px]`,
        },
      },
      onTransaction: () => setTick((tick) => tick + 1),
      onUpdate: ({ editor: activeEditor }) => {
        onChange(activeEditor.getJSON());
      },
    },
    [],
  );

  if (readOnly) {
    return (
      <div className="cmsc:font-sans cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:rounded-[8px] cmsc:bg-white cmsc:p-[12px]">
        <span
          className="cmsc:font-sans cmsc:text-[#334155] cmsc:text-[14px]"
          dangerouslySetInnerHTML={{
            __html: htmlFromTiptap(value) || sanitizeRichHtml('') || `<p>${escapeHtml(text('richText.empty'))}</p>`,
          }}
        />
      </div>
    );
  }

  const shell = (
    <div className={expanded ? 'cmsc:flex cmsc:flex-col cmsc:w-full cmsc:h-full' : 'cmsc:flex cmsc:flex-col'}>
      <Toolbar
        editor={editor}
        expanded={expanded}
        onToggleExpand={() => {
          // Full screen opens to the text, not to the first toolbar control.
          if (!expanded) editor?.commands.focus();
          setExpanded(!expanded);
        }}
        expandButtonRef={expandButtonRef}
        {...(toolbarExtra !== undefined ? { toolbarExtra } : {})}
      />
      <div
        className={`cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:border-t-0 cmsc:rounded-b-[8px] cmsc:bg-white cmsc:p-[14px] cmsc:overflow-auto ${
          expanded ? 'cmsc:flex-1' : 'cmsc:min-h-[160px]'
        }`}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );

  // #1652: full screen is a modal dialog — named, focus held, Escape and the scrim collapse it,
  // and focus returns to the toggle of the collapsed editor, which is a new element by then.
  if (expanded) {
    return (
      <CmsModalDialog
        title={text('richText.fullscreen')}
        hideTitle
        variant="fullscreen"
        onClose={() => setExpanded(false)}
        returnFocusRef={expandButtonRef}
      >
        {shell}
      </CmsModalDialog>
    );
  }

  return shell;
}
