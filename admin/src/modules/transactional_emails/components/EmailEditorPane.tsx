import { useEffect, useMemo, useState } from 'react';
import { Puck, type Config, type ComponentConfig, type Data } from '@measured/puck';
import '@measured/puck/puck.css';
import { defaultEmailBuilderConfig } from '@b2b/email-components';
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

  const config = useMemo(() => mergeConfig(blockOptions, templateOptions), [blockOptions, templateOptions]);

  return (
    <div className="min-h-[560px] overflow-hidden rounded-md border">
      <Puck
        key={editorKey}
        config={config}
        data={data ?? emptyData}
        onChange={onChange}
        overrides={{ headerActions: () => <></> }}
      />
    </div>
  );
}
