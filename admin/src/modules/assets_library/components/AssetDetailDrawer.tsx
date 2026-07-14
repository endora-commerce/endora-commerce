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
import { useTranslation } from '@/i18n/useTranslation';
import {
  assetsLibraryClient,
  type AssetDetail,
} from '../api/assets-library-client';

const apiBaseUrl =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3001';

/**
 * The backend serves files at /assets/file/:assetId and returns a host-relative
 * URL when publicUrlBase is blank (the default). The admin runs on a different
 * origin than the backend, so opening such a URL hits the admin SPA (which
 * renders "page not found") instead of the file. Prefix host-relative URLs
 * with the API base; absolute/data/blob URLs pass through unchanged.
 */
function toAbsoluteAssetUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  if (url.startsWith('/')) return `${apiBaseUrl.replace(/\/+$/, '')}${url}`;
  return url;
}

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
  const t = useTranslation('assets_library');
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
    return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
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
        <CardTitle className="text-base">{t('detail.title')}</CardTitle>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          ✕
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {detail.mimeType.startsWith('image/') ? (
          // eslint-disable-next-line jsx-a11y/alt-text
          <img
            src={toAbsoluteAssetUrl(detail.url)}
            className="w-full rounded border bg-muted/30 object-contain"
          />
        ) : (
          <div className="rounded border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
            {detail.mimeType}
          </div>
        )}

        <a
          href={toAbsoluteAssetUrl(detail.url)}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1 text-xs underline"
        >
          {t('detail.openFile')} <ExternalLink className="size-3" />
        </a>

        <Field label={t('detail.filename')} value={detail.filename} onSave={(v): Promise<void> => save({ filename: v })} disabled={busy} saveLabel={t('common.save')} />
        <Field
          label={t('detail.label')}
          value={detail.label ?? ''}
          placeholder={t('common.optional')}
          onSave={(v): Promise<void> => save({ label: v.length === 0 ? null : v })}
          disabled={busy}
          saveLabel={t('common.save')}
        />
        <Field
          label={t('detail.mimeType')}
          value={detail.mimeType}
          onSave={(v): Promise<void> => save({ mimeType: v })}
          disabled={busy}
          saveLabel={t('common.save')}
        />

        <div className="space-y-1">
          <Label>{t('detail.visibility')}</Label>
          <Select
            value={detail.visibility}
            onChange={(e): void => {
              const v = e.target.value as 'public' | 'private';
              void save({ visibility: v });
            }}
            disabled={busy}
          >
            <option value="public">{t('visibility.public')}</option>
            <option value="private">{t('visibility.private')}</option>
          </Select>
        </div>

        <div className="text-xs text-muted-foreground">
          {t('detail.storage')}: {detail.storageBackend} · {t('detail.size')}: {detail.sizeBytes} {t('detail.bytes')}
        </div>

        <div className="border-t pt-3">
          <p className="mb-1 text-sm font-medium">{t('detail.referencedBy')}</p>
          {detail.references.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('detail.notReferenced')}</p>
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
                ? t('detail.softDeleteBlockedTitle')
                : t('detail.softDeleteTitle')
            }
            onClick={(): void => void softDelete()}
          >
            <Trash2 className="size-4 mr-1" /> {t('detail.softDelete')}
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
  saveLabel,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onSave: (v: string) => Promise<void> | void;
  disabled?: boolean;
  saveLabel: string;
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
            {saveLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
