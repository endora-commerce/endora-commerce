'use client';

import { generateHTML, type JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { type ComponentConfig } from '@measured/puck';
import { useMemo, useState } from 'react';
import type { TextProps } from '../schema/component-types.js';

// The former `editorFrame` CSSProperties as `cmsc:`-prefixed utilities (verbatim:
// 1px solid #d9e0e7, radius 8, padding 12, white bg, Inter font). Feature 041.
const EDITOR_FRAME =
  'cmsc:font-sans cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:rounded-[8px] cmsc:p-[12px] cmsc:bg-white';

const defaultContent: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body copy' }] }],
};

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
]);

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/\s(href|src)=["']javascript:[^"']*["']/gi, '')
    .replace(/<\/?([a-z0-9-]+)(\s[^>]*)?>/gi, (match, tagName: string) => {
      if (!allowedTags.has(tagName.toLowerCase())) return '';
      return match;
    });
}

function htmlFromTiptap(content: JSONContent | null): string {
  if (!content) return '';

  try {
    return sanitizeHtml(generateHTML(content, [StarterKit]));
  } catch {
    return '';
  }
}

function RichTextField({
  value,
  onChange,
  readOnly,
}: {
  value: JSONContent | null;
  onChange: (value: JSONContent | null) => void;
  readOnly?: boolean | undefined;
}) {
  const [focused, setFocused] = useState(false);
  const editor = useEditor(
    {
      extensions: [StarterKit],
      content: value ?? defaultContent,
      editable: !readOnly,
      immediatelyRender: false,
      onUpdate: ({ editor: activeEditor }) => {
        onChange(activeEditor.getJSON());
      },
    },
    [],
  );

  if (!focused) {
    return (
      <button
        type="button"
        onFocus={() => setFocused(true)}
        onClick={() => setFocused(true)}
        className={`${EDITOR_FRAME} cmsc:block cmsc:w-full cmsc:min-h-[88px] cmsc:text-left ${
          readOnly ? 'cmsc:cursor-default' : 'cmsc:cursor-text'
        }`}
        disabled={readOnly}
      >
        <span
          className="cmsc:font-sans cmsc:text-[#334155] cmsc:text-[14px]"
          dangerouslySetInnerHTML={{
            __html: htmlFromTiptap(value) || '<p>Focus to edit rich text</p>',
          }}
        />
      </button>
    );
  }

  return (
    <div className={EDITOR_FRAME}>
      <EditorContent editor={editor} />
    </div>
  );
}

export const Text: ComponentConfig<TextProps> = {
  label: 'Text',
  fields: {
    tiptapContent: {
      type: 'custom',
      label: 'Content',
      render: ({ value, onChange, readOnly }) => (
        <RichTextField value={value ?? null} onChange={onChange} readOnly={readOnly} />
      ),
    },
    html: { type: 'textarea', label: 'HTML fallback' },
  },
  defaultProps: {
    tiptapContent: defaultContent,
    html: '',
  },
  render: ({ tiptapContent, html }) => {
    const safeHtml = useMemo(
      () => htmlFromTiptap(tiptapContent) || sanitizeHtml(html),
      [html, tiptapContent],
    );

    return (
      <div
        className="cmsc:font-sans cmsc:text-[#243447] cmsc:text-[16px] cmsc:leading-[1.65]"
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    );
  },
};
