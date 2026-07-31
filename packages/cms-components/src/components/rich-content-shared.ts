import { generateHTML, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import type { RichContentProps } from '../schema/component-types.js';

export const richContentExtensions = [
  StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  TextStyle,
  Color,
  Highlight.configure({ multicolor: true }),
  Image.configure({ inline: false, allowBase64: false }),
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
]);

const SAFE_STYLE_PROPS = /^(color|background-color)\s*:\s*[^;]+;?/gi;

function sanitizeStyleAttr(style: string): string {
  const kept: string[] = [];
  for (const match of style.matchAll(SAFE_STYLE_PROPS)) {
    kept.push(match[0].replace(/;?\s*$/, ''));
  }
  return kept.join('; ');
}

export function sanitizeRichHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/\s(href|src)=["']javascript:[^"']*["']/gi, '')
    .replace(/\sstyle=(["'])([\s\S]*?)\1/gi, (_full, quote: string, style: string) => {
      const cleaned = sanitizeStyleAttr(style);
      return cleaned ? ` style=${quote}${cleaned}${quote}` : '';
    })
    .replace(/<\/?([a-z0-9-]+)(\s[^>]*)?>/gi, (match, tagName: string) => {
      if (!allowedTags.has(tagName.toLowerCase())) return '';
      return match;
    });
}

export function htmlFromTiptap(content: JSONContent | null): string {
  if (!content) return '';

  try {
    return sanitizeRichHtml(generateHTML(content, richContentExtensions));
  } catch {
    return '';
  }
}

export const RICH_CONTENT_PROSE_CLASS =
  'cmsc:font-sans cmsc:text-[#243447] cmsc:text-[16px] cmsc:leading-[1.65] cmsc:[&_h1]:text-[32px] cmsc:[&_h2]:text-[26px] cmsc:[&_h3]:text-[22px] cmsc:[&_h4]:text-[18px] cmsc:[&_h1]:font-bold cmsc:[&_h2]:font-bold cmsc:[&_h3]:font-bold cmsc:[&_h4]:font-bold cmsc:[&_h1]:text-[#15202b] cmsc:[&_h2]:text-[#15202b] cmsc:[&_h3]:text-[#15202b] cmsc:[&_h4]:text-[#15202b] cmsc:[&_ul]:list-disc cmsc:[&_ol]:list-decimal cmsc:[&_ul]:pl-[24px] cmsc:[&_ol]:pl-[24px] cmsc:[&_blockquote]:border-l-4 cmsc:[&_blockquote]:border-[#d9e0e7] cmsc:[&_blockquote]:pl-[14px] cmsc:[&_blockquote]:text-[#475569] cmsc:[&_blockquote]:italic cmsc:[&_a]:text-[#2563eb] cmsc:[&_a]:underline cmsc:[&_pre]:bg-[#0f172a] cmsc:[&_pre]:text-white cmsc:[&_pre]:rounded-[8px] cmsc:[&_pre]:p-[12px] cmsc:[&_pre]:overflow-auto cmsc:[&_code]:font-mono cmsc:[&_img]:max-w-full cmsc:[&_img]:h-auto cmsc:[&_img]:rounded-[8px]';

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
