'use client';

import { generateHTML, type JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { type ComponentConfig } from '@measured/puck';
import { useMemo, useState } from 'react';
import type { TextProps } from '../schema/component-types.js';
import { baseFont, editorFrame } from './styles.js';

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
        style={{
          ...editorFrame,
          display: 'block',
          width: '100%',
          minHeight: 88,
          textAlign: 'left',
          cursor: readOnly ? 'default' : 'text',
        }}
        disabled={readOnly}
      >
        <span
          style={{ ...baseFont, color: '#334155', fontSize: 14 }}
          dangerouslySetInnerHTML={{
            __html: htmlFromTiptap(value) || '<p>Focus to edit rich text</p>',
          }}
        />
      </button>
    );
  }

  return (
    <div style={editorFrame}>
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
        style={{ ...baseFont, color: '#243447', fontSize: 16, lineHeight: 1.65 }}
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    );
  },
};
