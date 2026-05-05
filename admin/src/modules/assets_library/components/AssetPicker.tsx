// Asset picker — feature 013 / US1.
// Browse + search + (optional) inline upload, returning a chosen AssetSummary
// to the caller via onSelect. Renders inline (collapsible card) rather than
// as a modal because the admin app has no Dialog primitive yet.

import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AssetUploader } from './AssetUploader';
import {
  assetsLibraryClient,
  type AssetDetail,
  type AssetSummary,
} from '../api/assets-library-client';

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
  const [q, setQ] = useState('');
  const [items, setItems] = useState<AssetSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = (): void => {
    setLoading(true);
    setError(null);
    assetsLibraryClient
      .listAssets({
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
            placeholder="Search by filename or label…"
            onChange={(e): void => setQ(e.target.value)}
            onKeyDown={(e): void => {
              if (e.key === 'Enter') reload();
            }}
          />
          <Button type="button" variant="outline" size="sm" onClick={reload}>
            Search
          </Button>
          {props.onClose ? (
            <Button type="button" variant="ghost" size="sm" onClick={props.onClose}>
              Close
            </Button>
          ) : null}
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No assets match this query yet.</p>
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
                    src={a.url}
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
            <p className="mb-1 text-sm font-medium">Or upload a new asset</p>
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
