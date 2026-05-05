// Drag-and-drop / file-input uploader — feature 013 / US1.
// Streams a single file to the Library via the typed client and emits the
// resulting AssetDetail on success.

import { useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  assetsLibraryClient,
  type AssetDetail,
  type UploadFields,
} from '../api/assets-library-client';

export interface AssetUploaderProps {
  /** File MIME prefix to accept — e.g. 'image/' for image-only inputs. */
  acceptPrefix?: 'image/' | 'video/' | undefined;
  /** Default upload fields (folder, label, visibility). */
  defaults?: UploadFields;
  /** Called after a successful upload. */
  onUploaded: (asset: AssetDetail) => void;
  /** Optional inline label for the trigger button. */
  triggerLabel?: string;
}

export function AssetUploader({
  acceptPrefix,
  defaults,
  onUploaded,
  triggerLabel = 'Upload file',
}: AssetUploaderProps): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragHover, setDragHover] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File): Promise<void> => {
    setError(null);
    if (acceptPrefix && !file.type.startsWith(acceptPrefix)) {
      setError(`Expected a ${acceptPrefix.replace('/', '')} file; got "${file.type || file.name}".`);
      return;
    }
    setBusy(true);
    try {
      const asset = await assetsLibraryClient.uploadAsset(file, defaults ?? {});
      onUploaded(asset);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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

  const accept = acceptPrefix
    ? acceptPrefix === 'image/'
      ? 'image/*'
      : 'video/*'
    : undefined;

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragHover(true);
        }}
        onDragLeave={() => setDragHover(false)}
        onDrop={onDrop}
        className={`rounded-md border-2 border-dashed p-4 text-center text-sm ${
          dragHover ? 'border-primary bg-primary/5' : 'border-muted-foreground/30'
        }`}
        aria-label="Drop a file here or click to upload"
      >
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          accept={accept}
          onChange={onChange}
        />
        <p className="text-muted-foreground">
          {busy
            ? 'Uploading…'
            : 'Drop a file here, or click to choose one'}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          {busy ? 'Uploading…' : triggerLabel}
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
