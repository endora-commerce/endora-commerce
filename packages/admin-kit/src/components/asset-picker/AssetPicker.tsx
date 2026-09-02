// Asset picker — feature 013 / US1.
// Browse + search + (optional) inline upload, returning a chosen AssetSummary
// to the caller via onSelect. Renders inline (collapsible card) rather than
// as a modal because the admin app has no Dialog primitive yet.

import { useEffect, useState, type ReactNode } from 'react';
import type { AssetDetail, AssetSummary } from '@endora-commerce/contracts';
import { Button } from '../../ui/button.js';
import { Card, CardContent } from '../../ui/card.js';
import { Input } from '../../ui/input.js';
import { Alert, AlertDescription } from '../../ui/alert.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { toAbsoluteAssetUrl } from '../../lib/index.js';
import { AssetUploader } from './AssetUploader.js';
import { listAssets } from './assets-api.js';

/**
 * **Its copy is `core`'s, not `assets_library`'s** (R-1, 2026-08-31). The
 * component used to call `useTranslation('assets_library')`, which R6 rules is
 * module knowledge for the same reason an admin API client is: the bundle behind
 * a namespace is shipped by a module package the kit does not and may not depend
 * on, resolved at runtime by string, and a renamed key renders `core.<key>` at
 * the operator rather than failing to compile. `Close`, `Loading…` and `Search`
 * are concepts `core` already names, so this reads those; the picker's own three
 * strings moved into `core` under `assetPicker.*`.
 *
 * **The request is built here** (feature 091, P4c). Until this component moved
 * into the kit it called `assets_library`' own admin API client, which is a
 * reach out of the platform's frontend into a module's admin code.
 * `AssetSummary` and `AssetDetail` are `@endora-commerce/contracts`', so only
 * the one `GET` is rebuilt; the shape is the module's published one and is not
 * duplicated.
 */

export interface AssetPickerProps {
  /** Filter the picker grid by MIME prefix — e.g. 'image/' for images-only. */
  acceptMimePrefix?: 'image/' | 'video/' | undefined;
  /** Whether to render the inline upload affordance below the grid. */
  allowUpload?: boolean;
  /** Asset chosen → caller resolves any related entity wiring. */
  onSelect: (asset: AssetSummary | AssetDetail) => void;
  /** Optional close handler when used inside an expandable region. */
  onClose?: () => void;
}

export function AssetPicker(props: AssetPickerProps): ReactNode {
  const t = useTranslation('core');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<AssetSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = (): void => {
    setLoading(true);
    setError(null);
    listAssets({
      folderId: null,
      ...(q ? { q } : {}),
      ...(props.acceptMimePrefix ? { mime: props.acceptMimePrefix } : {}),
      limit: 24,
    })
      .then((res) => setItems(res.data))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.acceptMimePrefix]);

  return (
    <Card className="border-2 border-primary/40">
      <CardContent className="space-y-3 pt-4">
        <div className="flex items-center gap-2">
          <Input
            value={q}
            placeholder={t('assetPicker.searchPlaceholder')}
            onChange={(e): void => setQ(e.target.value)}
            onKeyDown={(e): void => {
              if (e.key === 'Enter') reload();
            }}
          />
          <Button type="button" variant="outline" size="sm" onClick={reload}>
            {t('common.action.search')}
          </Button>
          {props.onClose ? (
            <Button type="button" variant="ghost" size="sm" onClick={props.onClose}>
              {t('common.action.close')}
            </Button>
          ) : null}
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">{t('common.state.loading')}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('assetPicker.empty')}</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {items.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={(): void => props.onSelect(a)}
                className="group relative overflow-hidden rounded-md border bg-muted/30 p-1 text-left transition hover:border-primary"
                title={a.filename}
              >
                {a.mimeType.startsWith('image/') ? (
                  // eslint-disable-next-line jsx-a11y/alt-text
                  <img
                    src={toAbsoluteAssetUrl(a.url)}
                    className="aspect-square w-full rounded object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center rounded bg-muted text-xs text-muted-foreground">
                    {a.mimeType}
                  </div>
                )}
                <div className="mt-1 truncate text-xs">{a.label ?? a.filename}</div>
              </button>
            ))}
          </div>
        )}

        {props.allowUpload ? (
          <div className="border-t pt-3">
            <p className="mb-1 text-sm font-medium">{t('assetPicker.uploadNew')}</p>
            <AssetUploader
              {...(props.acceptMimePrefix !== undefined
                ? { acceptPrefix: props.acceptMimePrefix }
                : {})}
              onUploaded={(a): void => {
                // Newly-uploaded asset goes into the grid AND is selected.
                setItems((prev) => [
                  {
                    id: a.id,
                    folderId: a.folderId,
                    filename: a.filename,
                    label: a.label,
                    mimeType: a.mimeType,
                    sizeBytes: a.sizeBytes,
                    visibility: a.visibility,
                    storageBackend: a.storageBackend,
                    url: a.url,
                    createdAt: a.createdAt,
                    updatedAt: a.updatedAt,
                    deletedAt: a.deletedAt,
                    pendingCleanup: a.pendingCleanup,
                  },
                  ...prev,
                ]);
                props.onSelect(a);
              }}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
