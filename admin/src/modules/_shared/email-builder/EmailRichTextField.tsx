import { lazy, Suspense, type ReactElement } from 'react';
import type { CustomField } from '@measured/puck';
import { sanitizeEmailHtml } from '@endora-commerce/email-components';
import { htmlFromTiptap } from '@endora-commerce/cms-components';
import { Button } from '@/components/ui/button';
import { toAbsoluteAssetUrl } from '@endora-commerce/admin-kit/lib';
import { useEmailVariables } from './EmailVariablesProvider';

/**
 * Reuses the CMS Page Builder Rich Content TipTap field, plus an email Variable
 * button. Persisted authoring value is TipTap JSON (`content`); `html` is synced
 * in resolveData via sanitizeEmailHtml(htmlFromTiptap(...)).
 */

type TipTapJson = Parameters<typeof htmlFromTiptap>[0];

const LazyRichContentEditorField = lazy(async () => {
  const mod = await import('@endora-commerce/cms-components');
  return { default: mod.RichContentEditorField };
});

function VariableToolbarButton({
  insert,
}: {
  insert: (snippet: string) => void;
}): ReactElement {
  const { openPicker } = useEmailVariables();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-[30px] px-2 text-xs"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => openPicker(insert)}
    >
      Variable
    </Button>
  );
}

function EmailRichTextContentEditor({
  value,
  onChange,
  readOnly = false,
}: {
  value?: TipTapJson | null;
  onChange: (value: TipTapJson | null) => void;
  readOnly?: boolean;
}): ReactElement {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading editor…</p>}>
      <LazyRichContentEditorField
        value={value ?? null}
        onChange={onChange}
        {...(readOnly ? { readOnly: true } : {})}
        toolbarExtra={(editor) => (
          <VariableToolbarButton
            insert={(snippet) => {
              editor.chain().focus().insertContent(snippet).run();
            }}
          />
        )}
      />
    </Suspense>
  );
}

/** Puck custom field bound to EmailRichText `content` (TipTap JSON). */
export const emailRichTextContentField: CustomField<TipTapJson | null> = {
  type: 'custom',
  label: 'Rich text',
  render: ({ value, onChange, readOnly }) => (
    <EmailRichTextContentEditor
      value={value}
      onChange={onChange}
      {...(readOnly !== undefined ? { readOnly } : {})}
    />
  ),
};

/** Make host-relative image URLs absolute so email clients / preview can load them. */
function absolutizeImgSrcs(html: string): string {
  return html.replace(/<img\b([^>]*?)\bsrc="([^"]*)"/gi, (_full, before: string, src: string) => {
    const absolute = toAbsoluteAssetUrl(src);
    return `<img${before}src="${absolute.replace(/"/g, '&quot;')}"`;
  });
}

/** Sync TipTap JSON → email-safe HTML string. */
export function emailHtmlFromRichContent(content: unknown): string {
  if (!content || typeof content !== 'object') return '';
  try {
    return absolutizeImgSrcs(sanitizeEmailHtml(htmlFromTiptap(content as TipTapJson)));
  } catch {
    return '';
  }
}
