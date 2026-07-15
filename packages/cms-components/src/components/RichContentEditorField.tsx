'use client';

import { type Editor, type JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  RICH_CONTENT_PROSE_CLASS,
  defaultRichContent,
  htmlFromTiptap,
  richContentExtensions,
  sanitizeRichHtml,
} from './rich-content-shared.js';

function ToolbarButton({
  children,
  title,
  active,
  disabled,
  onClick,
}: {
  children: ReactNode;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
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

function Divider() {
  return <span className="cmsc:self-stretch cmsc:w-px cmsc:my-[3px] cmsc:bg-[#d9e0e7]" />;
}

const BLOCK_OPTIONS = [
  { value: 'p', label: 'Paragraph' },
  { value: 'h1', label: 'Heading 1' },
  { value: 'h2', label: 'Heading 2' },
  { value: 'h3', label: 'Heading 3' },
  { value: 'h4', label: 'Heading 4' },
] as const;

function currentBlock(editor: Editor): string {
  for (const level of [1, 2, 3, 4] as const) {
    if (editor.isActive('heading', { level })) return `h${level}`;
  }
  return 'p';
}

function Toolbar({
  editor,
  expanded,
  onToggleExpand,
}: {
  editor: Editor | null;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  if (!editor) return null;

  const applyBlock = (value: string) => {
    const chain = editor.chain().focus();
    if (value === 'p') chain.setParagraph().run();
    else chain.setNode('heading', { level: Number(value.slice(1)) }).run();
  };

  const toggleLink = () => {
    const previous = (editor.getAttributes('link').href as string | undefined) ?? '';
    const url = window.prompt('Link URL (leave empty to remove)', previous);
    if (url === null) return;
    const range = editor.chain().focus().extendMarkRange('link');
    if (url.trim() === '') range.unsetLink().run();
    else range.setLink({ href: url.trim() }).run();
  };

  return (
    <div className="cmsc:flex cmsc:flex-wrap cmsc:items-center cmsc:gap-[3px] cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:rounded-t-[8px] cmsc:bg-[#f5f7fa] cmsc:px-[6px] cmsc:py-[5px]">
      <select
        value={currentBlock(editor)}
        onChange={(event) => applyBlock(event.target.value)}
        title="Block type"
        aria-label="Block type"
        className="cmsc:font-sans cmsc:h-[30px] cmsc:text-[13px] cmsc:text-[#334155] cmsc:bg-white cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:rounded-[6px] cmsc:px-[6px] cmsc:cursor-pointer"
      >
        {BLOCK_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <Divider />

      <ToolbarButton title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
        <strong>B</strong>
      </ToolbarButton>
      <ToolbarButton title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton title="Underline" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <span className="cmsc:underline">U</span>
      </ToolbarButton>
      <ToolbarButton title="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <span className="cmsc:line-through">S</span>
      </ToolbarButton>
      <ToolbarButton title="Inline code" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>
        {'</>'}
      </ToolbarButton>
      <ToolbarButton title="Link" active={editor.isActive('link')} onClick={toggleLink}>
        🔗
      </ToolbarButton>

      <Divider />

      <ToolbarButton title="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        •—
      </ToolbarButton>
      <ToolbarButton title="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        1.
      </ToolbarButton>
      <ToolbarButton title="Quote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        ❝
      </ToolbarButton>
      <ToolbarButton title="Code block" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
        {'{ }'}
      </ToolbarButton>
      <ToolbarButton title="Horizontal rule" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        ―
      </ToolbarButton>

      <Divider />

      <ToolbarButton title="Align left" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}>
        ⫷
      </ToolbarButton>
      <ToolbarButton title="Align center" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}>
        ☰
      </ToolbarButton>
      <ToolbarButton title="Align right" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}>
        ⫸
      </ToolbarButton>
      <ToolbarButton title="Justify" active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()}>
        ▤
      </ToolbarButton>

      <Divider />

      <ToolbarButton title="Clear formatting" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
        ⌫
      </ToolbarButton>
      <ToolbarButton title="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
        ↶
      </ToolbarButton>
      <ToolbarButton title="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
        ↷
      </ToolbarButton>

      <span className="cmsc:ml-auto" />
      <ToolbarButton title={expanded ? 'Collapse editor' : 'Expand editor to full screen'} active={expanded} onClick={onToggleExpand}>
        {expanded ? '🗗' : '⤢'}
      </ToolbarButton>
    </div>
  );
}

export function RichContentEditorField({
  value,
  onChange,
  readOnly,
}: {
  value: JSONContent | null;
  onChange: (value: JSONContent | null) => void;
  readOnly?: boolean | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const [, setTick] = useState(0);
  const editor = useEditor(
    {
      extensions: richContentExtensions,
      content: value ?? defaultRichContent,
      editable: !readOnly,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: `${RICH_CONTENT_PROSE_CLASS} cmsc:outline-none cmsc:min-h-[140px] cmsc:[&_p]:my-[8px] cmsc:[&_h1]:my-[8px] cmsc:[&_h2]:my-[8px] cmsc:[&_h3]:my-[8px] cmsc:[&_h4]:my-[8px] cmsc:[&_ul]:my-[8px] cmsc:[&_ol]:my-[8px] cmsc:[&_blockquote]:my-[8px]`,
        },
      },
      onTransaction: () => setTick((tick) => tick + 1),
      onUpdate: ({ editor: activeEditor }) => {
        onChange(activeEditor.getJSON());
      },
    },
    [],
  );

  useEffect(() => {
    if (!expanded) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [expanded]);

  if (readOnly) {
    return (
      <div className="cmsc:font-sans cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:rounded-[8px] cmsc:bg-white cmsc:p-[12px]">
        <span
          className="cmsc:font-sans cmsc:text-[#334155] cmsc:text-[14px]"
          dangerouslySetInnerHTML={{
            __html: htmlFromTiptap(value) || sanitizeRichHtml('') || '<p>No content</p>',
          }}
        />
      </div>
    );
  }

  const shell = (
    <div className={expanded ? 'cmsc:flex cmsc:flex-col cmsc:w-full cmsc:max-w-[860px] cmsc:mx-auto cmsc:h-full' : 'cmsc:flex cmsc:flex-col'}>
      <Toolbar editor={editor} expanded={expanded} onToggleExpand={() => setExpanded((on) => !on)} />
      <div
        className={`cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:border-t-0 cmsc:rounded-b-[8px] cmsc:bg-white cmsc:p-[14px] cmsc:overflow-auto ${
          expanded ? 'cmsc:flex-1' : 'cmsc:min-h-[160px]'
        }`}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );

  if (expanded && typeof document !== 'undefined') {
    return createPortal(
      <div
        className="cmsc:fixed cmsc:inset-0 cmsc:z-[2147483000] cmsc:bg-[rgba(15,23,42,0.55)] cmsc:p-[24px] cmsc:flex cmsc:flex-col"
        onClick={(event) => {
          if (event.target === event.currentTarget) setExpanded(false);
        }}
      >
        {shell}
      </div>,
      document.body,
    );
  }

  return shell;
}
