import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Puck, type Config, type ComponentConfig, type Data } from '@measured/puck';
import '@measured/puck/puck.css';
import { Maximize2, Minimize2 } from 'lucide-react';
import {
  defaultEmailBuilderConfig,
  EmailEmbedsProvider,
  renderEmailHtml,
  type EmailEmbeds,
} from '@b2b/email-components';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { transactionalEmailsClient } from '../api/transactional-emails-client';

const emptyData: Data = { root: { props: {} }, content: [] };

interface CodeOption {
  label: string;
  value: string;
}

/**
 * Render a block/template's stored content (per-language Puck trees) into an
 * on-canvas HTML preview. Prefers Polish, then English, then any language.
 */
function previewNode(content: Record<string, unknown>): ReactNode {
  const tree = content['pl-PL'] ?? content['en-US'] ?? Object.values(content)[0] ?? null;
  const html = renderEmailHtml(tree as never, { document: false });
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * Email-safe Puck editor (feature 047). Mirrors the CMS PageBuilderEditor but
 * uses the restricted email component palette from @b2b/email-components and
 * rewrites the InsertBlock/InsertTemplate code fields into dropdowns populated
 * from the reusable block/template library.
 */
function mergeConfig(blockOptions: CodeOption[], templateOptions: CodeOption[]): Config {
  const base = defaultEmailBuilderConfig;
  const components: Record<string, ComponentConfig> = { ...(base.components ?? {}) };

  const insertBlock = components['EmailInsertBlock'];
  if (insertBlock) {
    components['EmailInsertBlock'] = {
      ...insertBlock,
      fields: {
        ...insertBlock.fields,
        code: { type: 'select', label: 'Block', options: [{ label: '—', value: '' }, ...blockOptions] },
      },
    } as ComponentConfig;
  }
  const insertTemplate = components['EmailInsertTemplate'];
  if (insertTemplate) {
    components['EmailInsertTemplate'] = {
      ...insertTemplate,
      fields: {
        ...insertTemplate.fields,
        code: { type: 'select', label: 'Template', options: [{ label: '—', value: '' }, ...templateOptions] },
      },
    } as ComponentConfig;
  }
  return { ...base, components } as Config;
}

export interface EmailEditorPaneProps {
  data: Data;
  onChange: (data: Data) => void;
  /** Forces a Puck remount when the scope/language changes. */
  editorKey: string;
}

export function EmailEditorPane({ data, onChange, editorKey }: EmailEditorPaneProps): React.ReactElement {
  const [blockOptions, setBlockOptions] = useState<CodeOption[]>([]);
  const [templateOptions, setTemplateOptions] = useState<CodeOption[]>([]);
  const [embeds, setEmbeds] = useState<EmailEmbeds>({ blocks: {}, templates: {} });
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    let live = true;
    void (async (): Promise<void> => {
      const [blockRes, templateRes] = await Promise.all([
        transactionalEmailsClient.listBlocks().catch(() => ({ items: [] })),
        transactionalEmailsClient.listTemplates().catch(() => ({ items: [] })),
      ]);
      if (!live) return;
      setBlockOptions(blockRes.items.map((b) => ({ label: `${b.name} (${b.code})`, value: b.code })));
      setTemplateOptions(templateRes.items.map((t) => ({ label: `${t.name} (${t.code})`, value: t.code })));

      // Best-effort: resolve each block/template's content into an inline canvas
      // preview so InsertBlock/InsertTemplate render the referenced content
      // instead of just printing its code.
      const blockPreviews: Record<string, ReactNode> = {};
      await Promise.all(
        blockRes.items.map(async (b) => {
          try {
            const detail = await transactionalEmailsClient.getBlock(b.id);
            blockPreviews[b.code] = previewNode(detail.content);
          } catch {
            /* leave the code-only fallback */
          }
        }),
      );
      const templatePreviews: Record<string, ReactNode> = {};
      await Promise.all(
        templateRes.items.map(async (tpl) => {
          try {
            const detail = await transactionalEmailsClient.getTemplate(tpl.id);
            templatePreviews[tpl.code] = previewNode(detail.content);
          } catch {
            /* leave the code-only fallback */
          }
        }),
      );
      if (live) setEmbeds({ blocks: blockPreviews, templates: templatePreviews });
    })();
    return () => {
      live = false;
    };
  }, []);

  // Allow exiting fullscreen with Escape.
  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const config = useMemo(() => mergeConfig(blockOptions, templateOptions), [blockOptions, templateOptions]);

  return (
    <div className={cn('space-y-3', fullscreen && 'fixed inset-0 z-50 flex flex-col overflow-auto bg-background p-4')}>
      <div
        className={cn(
          'overflow-hidden rounded-md border',
          fullscreen ? 'min-h-0 flex-1' : 'min-h-[560px]',
        )}
      >
        <EmailEmbedsProvider value={embeds}>
          <Puck
            key={editorKey}
            config={config}
            data={data ?? emptyData}
            onChange={onChange}
            overrides={{
              headerActions: () => (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={(): void => setFullscreen((f) => !f)}
                  aria-pressed={fullscreen}
                >
                  {fullscreen ? (
                    <>
                      <Minimize2 className="mr-1 h-4 w-4" />
                      Exit fullscreen
                    </>
                  ) : (
                    <>
                      <Maximize2 className="mr-1 h-4 w-4" />
                      Fullscreen
                    </>
                  )}
                </Button>
              ),
            }}
          />
        </EmailEmbedsProvider>
      </div>
    </div>
  );
}
