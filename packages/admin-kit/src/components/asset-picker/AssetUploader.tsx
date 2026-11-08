// Drag-and-drop / file-input uploader — feature 013 / US1.
// Streams a single file to the Library and emits the resulting AssetDetail on
// success. The request is the kit's own since feature 091's P4c — see
// `./assets-api.ts` — and so is the copy, under `core`'s `assetPicker.upload.*`:
// R-1 (2026-08-31) rules a translation namespace to be module knowledge, so a
// kit component may not name `assets_library`'s bundle. `AssetPicker`'s header
// carries the reasoning.

import { useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import type { AssetDetail } from '@endora-commerce/contracts';
import { Button } from '../../ui/button.js';
import { Alert, AlertDescription } from '../../ui/alert.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { ApiError } from '../../lib/index.js';
import { uploadAsset, type AssetUploadFields } from './assets-api.js';

export interface AssetUploaderProps {
  /** File MIME prefix to accept — e.g. 'image/' for image-only inputs. */
  acceptPrefix?: 'image/' | 'video/' | undefined;
  /** Default upload fields (folder, label, visibility). */
  defaults?: AssetUploadFields;
  /** Called after a successful upload. */
  onUploaded: (asset: AssetDetail) => void;
  /** Optional inline label for the trigger button. */
  triggerLabel?: string;
  /**
   * Replaces the default upload request — the Library's replace action passes
   * one that replaces an existing asset's file. Optional; without it the file
   * is uploaded as a new asset.
   */
  upload?: (file: File) => Promise<AssetDetail>;
  /**
   * The whole `accept` attribute (e.g. `application/pdf`). Without it,
   * `acceptPrefix` decides it.
   */
  accept?: string;
}

export function AssetUploader({
  acceptPrefix,
  defaults,
  onUploaded,
  triggerLabel,
  upload,
  accept: acceptOverride,
}: AssetUploaderProps): ReactNode {
  const t = useTranslation('core');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragHover, setDragHover] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File): Promise<void> => {
    setError(null);
    if (acceptPrefix && !file.type.startsWith(acceptPrefix)) {
      setError(
        t('assetPicker.upload.error.wrongType', {
          expected: acceptPrefix.replace('/', ''),
          actual: file.type || file.name,
        }),
      );
      return;
    }
    setBusy(true);
    try {
      const asset = upload ? await upload(file) : await uploadAsset(file, defaults ?? {});
      onUploaded(asset);
    } catch (e) {
      // The server's own sentence for a refusal (issue #354: a failed upload
      // is an `ApiError` now, whose `message` is prefixed with its code).
      setError(e instanceof ApiError ? e.envelope.error.message : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
    if (fileInput.current) fileInput.current.value = '';
  };

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragHover(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) void handleFile(f);
  };

  const accept =
    acceptOverride ?? (acceptPrefix ? (acceptPrefix === 'image/' ? 'image/*' : 'video/*') : undefined);

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e): void => {
          e.preventDefault();
          setDragHover(true);
        }}
        onDragLeave={(): void => setDragHover(false)}
        onDrop={onDrop}
        className={`rounded-md border-2 border-dashed p-4 text-center text-sm ${
          dragHover ? 'border-primary bg-primary/5' : 'border-muted-foreground/30'
        }`}
        aria-label={t('assetPicker.upload.dropAria')}
      >
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          // Named like its trigger: hidden from view, but not from every
          // assistive technology or audit that reads the markup.
          aria-label={triggerLabel ?? t('assetPicker.upload.trigger')}
          accept={accept}
          onChange={onChange}
        />
        <p className="text-muted-foreground">
          {busy ? t('assetPicker.upload.uploading') : t('assetPicker.upload.dropCopy')}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          disabled={busy}
          onClick={(): void => fileInput.current?.click()}
        >
          {busy ? t('assetPicker.upload.uploading') : (triggerLabel ?? t('assetPicker.upload.trigger'))}
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
