import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Puck, type Config, type ComponentConfig, type Data } from '@measured/puck';
import '@measured/puck/puck.css';
// Self-contained, prefix-isolated (`cmsc:`) stylesheet for the shared CMS components
// (feature 041, FR-012b). This is the admin's ONLY change; it carries its own token
// values + no preflight, so it cannot restyle admin chrome.
import '@b2b/cms-components/styles.css';
import { defaultPageBuilderConfig, makeMissingComponentConfig } from '@b2b/cms-components';
import type { CmsPageBuilderDescriptor } from '@b2b/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useTranslation } from '@/i18n/useTranslation';
import { cmsClient } from '../api/cms-client';

const emptyData: Data = { root: { props: {} }, content: [] };

/**
 * Merges the locally-bundled `defaultPageBuilderConfig` from
 * `@b2b/cms-components` with the descriptor returned by the backend's
 * page-builder/config endpoint. Components that exist in the descriptor
 * but whose React renderer is missing from this admin bundle fall back to
 * `MissingComponentPlaceholder` so the editor stays usable while the
 * contributing module's renderer is being built.
 */
interface BlockOption {
  label: string;
  value: string;
}

function mergeConfig(
  descriptor: CmsPageBuilderDescriptor | null,
  extensionTitle: string,
  blockOptions: BlockOption[],
): Config {
  const base = defaultPageBuilderConfig;

  const components: Record<string, ComponentConfig> = {
    ...(base.components ?? {}),
  } as Record<string, ComponentConfig>;

  // Replace InsertBlock's free-text "Block code" field with a dropdown of the
  // available CMS blocks, so authors pick from a list instead of having to know
  // and type a code by hand.
  const insertBlock = components['InsertBlock'];
  if (insertBlock) {
    components['InsertBlock'] = {
      ...insertBlock,
      fields: {
        ...insertBlock.fields,
        code: {
          type: 'select',
          label: 'Block',
          options: [{ label: '—', value: '' }, ...blockOptions],
        },
      },
    } as ComponentConfig;
  }

  if (descriptor) {
    for (const entry of descriptor.components) {
      if (components[entry.name]) continue;
      components[entry.name] = makeMissingComponentConfig(entry.name, entry.ownerModule);
    }
  }

  const baseCategories = base.categories ?? {};
  const localNames = new Set(Object.keys(base.components ?? {}));
  const extensionNames = (descriptor?.components ?? [])
    .filter((entry) => !localNames.has(entry.name))
    .map((entry) => entry.name);

  const categories = extensionNames.length > 0
    ? {
        ...baseCategories,
        extensions: {
          title: extensionTitle,
          components: extensionNames,
        },
      }
    : baseCategories;

  return { ...base, components, categories } as Config;
}

export function PageBuilderEditor({
  data,
  onChange,
}: {
  data: Data | null;
  onChange: (data: Data) => void;
}): ReactNode {
  const t = useTranslation('cms');
  const [descriptor, setDescriptor] = useState<CmsPageBuilderDescriptor | null>(null);
  const [blockOptions, setBlockOptions] = useState<BlockOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    cmsClient
      .getPageBuilderConfig()
      .then((result) => {
        if (live) setDescriptor(result);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      live = false;
    };
  }, []);

  // Available CMS blocks power the InsertBlock dropdown. Best-effort: a failure
  // leaves the dropdown empty rather than breaking the editor.
  useEffect(() => {
    let live = true;
    cmsClient
      .listBlocks()
      .then((res) => {
        if (!live) return;
        setBlockOptions(
          res.data.map((b) => ({
            label: b.name ? `${b.name} (${b.code})` : b.code,
            value: b.code,
          })),
        );
      })
      .catch(() => {
        /* leave options empty on failure */
      });
    return () => {
      live = false;
    };
  }, []);

  const config = useMemo(
    () => mergeConfig(descriptor, t('pageBuilder.extensions'), blockOptions),
    [descriptor, t, blockOptions],
  );
  const editorData = data ?? emptyData;

  return (
    <div className="space-y-3">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {!descriptor && !error ? (
        <p className="text-sm text-muted-foreground">{t('pageBuilder.loadingConfig')}</p>
      ) : null}
      <div className="min-h-[640px] overflow-hidden rounded-md border">
        <Puck config={config} data={editorData} onChange={onChange} onPublish={onChange} />
      </div>
    </div>
  );
}

export type { Data as PageBuilderData };
