import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Puck, type Config, type ComponentConfig, type Data } from '@measured/puck';
import '@measured/puck/puck.css';
import { defaultPageBuilderConfig, makeMissingComponentConfig } from '@b2b/cms-components';
import type { CmsPageBuilderDescriptor } from '@b2b/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
function mergeConfig(descriptor: CmsPageBuilderDescriptor | null): Config {
  const base = defaultPageBuilderConfig;
  if (!descriptor) return base;

  const components: Record<string, ComponentConfig> = {
    ...(base.components ?? {}),
  } as Record<string, ComponentConfig>;
  for (const entry of descriptor.components) {
    if (components[entry.name]) continue;
    components[entry.name] = makeMissingComponentConfig(entry.name, entry.ownerModule);
  }

  const baseCategories = base.categories ?? {};
  const localNames = new Set(Object.keys(base.components ?? {}));
  const extensionNames = descriptor.components
    .filter((entry) => !localNames.has(entry.name))
    .map((entry) => entry.name);

  const categories = extensionNames.length > 0
    ? {
        ...baseCategories,
        extensions: {
          title: 'Extensions',
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
  const [descriptor, setDescriptor] = useState<CmsPageBuilderDescriptor | null>(null);
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

  const config = useMemo(() => mergeConfig(descriptor), [descriptor]);
  const editorData = data ?? emptyData;

  return (
    <div className="space-y-3">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {!descriptor && !error ? (
        <p className="text-sm text-muted-foreground">Loading Page Builder config…</p>
      ) : null}
      <div className="min-h-[640px] overflow-hidden rounded-md border">
        <Puck config={config} data={editorData} onChange={onChange} onPublish={onChange} />
      </div>
    </div>
  );
}

export type { Data as PageBuilderData };
