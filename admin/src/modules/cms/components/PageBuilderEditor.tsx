import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Puck, type Config, type ComponentConfig, type Data } from '@measured/puck';
import { Maximize2, Minimize2 } from 'lucide-react';
import '@measured/puck/puck.css';
// Self-contained, prefix-isolated (`cmsc:`) stylesheet for the shared CMS components
// (feature 041, FR-012b). This is the admin's ONLY change; it carries its own token
// values + no preflight, so it cannot restyle admin chrome.
import '@b2b/cms-components/styles.css';
import { defaultPageBuilderConfig, makeMissingComponentConfig } from '@b2b/cms-components';
import type { CmsPageBuilderDescriptor } from '@b2b/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
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
  contentKey,
}: {
  data: Data | null;
  onChange: (data: Data) => void;
  /**
   * Identity of the content currently loaded into the editor — typically
   * `${resourceId}:${language}`. Puck seeds its internal editor state from
   * `data` only on mount (the `data` prop is treated as *initial* data, not a
   * controlled value), so when the surrounding editor finishes its async
   * fetch and swaps `data` from the empty placeholder to the saved tree, Puck
   * would otherwise keep showing the empty canvas. Threading this through as
   * the Puck `key` forces a remount whenever a different resource/language is
   * loaded, re-seeding from the freshly-loaded `data`. It deliberately does
   * NOT change on every keystroke (which flows through `onChange`/draft
   * state), so editing stays smooth and never loses focus.
   */
  contentKey?: string;
}): ReactNode {
  const t = useTranslation('cms');
  const [descriptor, setDescriptor] = useState<CmsPageBuilderDescriptor | null>(null);
  const [blockOptions, setBlockOptions] = useState<BlockOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  // Allow exiting fullscreen with Escape.
  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return (): void => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

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
    <div
      className={cn(
        'space-y-3',
        fullscreen && 'fixed inset-0 z-50 flex flex-col overflow-auto bg-background p-4',
      )}
    >
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {!descriptor && !error ? (
        <p className="text-sm text-muted-foreground">{t('pageBuilder.loadingConfig')}</p>
      ) : null}
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
              {t('pageBuilder.fullscreen.exit')}
            </>
          ) : (
            <>
              <Maximize2 className="mr-1 h-4 w-4" />
              {t('pageBuilder.fullscreen.enter')}
            </>
          )}
        </Button>
      </div>
      <div
        className={cn(
          'overflow-hidden rounded-md border',
          fullscreen ? 'min-h-0 flex-1' : 'min-h-[640px]',
        )}
      >
        {/* Content is persisted by the surrounding editor's own Save actions, so
            Puck's built-in "Publish" header button is redundant and misleading —
            hide it by emptying the header-actions slot. */}
        <Puck
          key={contentKey}
          config={config}
          data={editorData}
          onChange={onChange}
          overrides={{ headerActions: () => <></> }}
        />
      </div>
    </div>
  );
}

export type { Data as PageBuilderData };
