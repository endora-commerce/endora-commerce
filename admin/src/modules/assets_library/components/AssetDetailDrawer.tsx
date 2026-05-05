// Asset detail drawer — feature 013 / US2 / T068.
// Displays a single asset's metadata + reference list, supports inline edits
// (filename, label, mimeType, visibility) and a soft-delete affordance.

import { useEffect, useState, type ReactNode } from 'react';
import { ExternalLink, Trash2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  assetsLibraryClient,
  type AssetDetail,
} from '../api/assets-library-client';

export interface AssetDetailDrawerProps {
  assetId: string;
  onChanged: () => void;
  onClose: () => void;
}

export function AssetDetailDrawer({
  assetId,
  onChanged,
  onClose,
}: AssetDetailDrawerProps): ReactNode {
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = (): void => {
    setError(null);
    assetsLibraryClient
      .getAsset(assetId)
      .then(setDetail)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!detail) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const save = async (patch: {
    filename?: string;
    label?: string | null;
    mimeType?: string;
    visibility?: 'public' | 'private';
  }): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const next = await assetsLibraryClient.patchAsset(assetId, patch);
      setDetail(next);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const softDelete = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await assetsLibraryClient.softDeleteAsset(assetId);
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="sticky top-2 max-h-[calc(100vh-2rem)] overflow-y-auto">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Asset detail</CardTitle>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          ✕
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {detail.mimeType.startsWith('image/') ? (
          // eslint-disable-next-line jsx-a11y/alt-text
          <img
            src={detail.url}
            className="w-full rounded border bg-muted/30 object-contain"
          />
        ) : (
          <div className="rounded border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
            {detail.mimeType}
          </div>
        )}

        <a
          href={detail.url}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1 text-xs underline"
        >
          Open file <ExternalLink className="size-3" />
        </a>

        <Field label="Filename" value={detail.filename} onSave={(v): Promise<void> => save({ filename: v })} disabled={busy} />
        <Field
          label="Label (storefront)"
          value={detail.label ?? ''}
          placeholder="(optional)"
          onSave={(v): Promise<void> => save({ label: v.length === 0 ? null : v })}
          disabled={busy}
        />
        <Field
          label="MIME type"
          value={detail.mimeType}
          onSave={(v): Promise<void> => save({ mimeType: v })}
          disabled={busy}
        />

        <div className="space-y-1">
          <Label>Visibility</Label>
          <Select
            value={detail.visibility}
            onChange={(e): void => {
              const v = e.target.value as 'public' | 'private';
              void save({ visibility: v });
            }}
            disabled={busy}
          >
            <option value="public">public</option>
            <option value="private">private</option>
          </Select>
        </div>

        <div className="text-xs text-muted-foreground">
          Storage: {detail.storageBackend} · Size: {detail.sizeBytes} bytes
        </div>

        <div className="border-t pt-3">
          <p className="mb-1 text-sm font-medium">Referenced by</p>
          {detail.references.length === 0 ? (
            <p className="text-xs text-muted-foreground">Not referenced.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {detail.references.map((r, i) => (
                <li key={`${r.kind}-${r.entityId}-${i}`}>
                  <span className="font-mono text-muted-foreground">{r.kind}</span>
                  {' — '}
                  {r.label}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t pt-3">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={busy || detail.references.length > 0}
            title={
              detail.references.length > 0
                ? 'Remove every reference first'
                : 'Soft-delete this asset'
            }
            onClick={(): void => void softDelete()}
          >
            <Trash2 className="size-4 mr-1" /> Soft-delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  placeholder,
  onSave,
  disabled,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onSave: (v: string) => Promise<void> | void;
  disabled?: boolean;
}): ReactNode {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const dirty = v !== value;
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          value={v}
          {...(placeholder !== undefined ? { placeholder } : {})}
          onChange={(e): void => setV(e.target.value)}
          disabled={disabled}
        />
        {dirty ? (
          <Button type="button" size="sm" onClick={(): void => void onSave(v)} disabled={disabled}>
            Save
          </Button>
        ) : null}
      </div>
    </div>
  );
}
