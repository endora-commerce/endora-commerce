import { useEffect, useMemo, useState } from 'react';
import { Puck, type Config, type ComponentConfig, type Data } from '@measured/puck';
import '@measured/puck/puck.css';
import { Maximize2, Minimize2 } from 'lucide-react';
import { defaultEmailBuilderConfig } from '@b2b/email-components';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { transactionalEmailsClient } from '../api/transactional-emails-client';

const emptyData: Data = { root: { props: {} }, content: [] };

interface CodeOption {
  label: string;
  value: string;
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
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    let live = true;
    void transactionalEmailsClient.listBlocks().then((res) => {
      if (live) setBlockOptions(res.items.map((b) => ({ label: `${b.name} (${b.code})`, value: b.code })));
    });
    void transactionalEmailsClient.listTemplates().then((res) => {
      if (live) setTemplateOptions(res.items.map((t) => ({ label: `${t.name} (${t.code})`, value: t.code })));
    });
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
      <div className="flex justify-end">
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
      </div>
      <div
        className={cn(
          'overflow-hidden rounded-md border',
          fullscreen ? 'min-h-0 flex-1' : 'min-h-[560px]',
        )}
      >
        <Puck
          key={editorKey}
          config={config}
          data={data ?? emptyData}
          onChange={onChange}
          overrides={{ headerActions: () => <></> }}
        />
      </div>
    </div>
  );
}
