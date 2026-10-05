import { useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@endora-commerce/admin-kit/ui';

export interface AttachmentUploaderProps {
  /** The button's label. */
  label: string;
  /** The sentence above the button: what may be dropped here, or what is being uploaded. */
  hint: string;
  /** A file is on its way: the control takes no second one. */
  busy: boolean;
  onFile: (file: File) => void;
}

/**
 * Choose a file, or drop one: the control the *Attachments* tab adds a file
 * with. It hands the file over and does nothing else — the tab uploads it,
 * through CRM's own endpoint.
 *
 * Module-private rather than the kit's `AssetUploader`: that one posts to the
 * media library's upload endpoint itself, which is the library's permission
 * and the reason a Sales Rep could not add a file (research N-D8, N-F1).
 *
 * The button is the keyboard path and the whole dashed region the pointer's;
 * a drop is an addition, never the only way.
 */
export function AttachmentUploader({ label, hint, busy, onFile }: AttachmentUploaderProps): ReactNode {
  const input = useRef<HTMLInputElement>(null);
  const [hover, setHover] = useState(false);

  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    // Cleared so choosing the same file again is a change again.
    event.target.value = '';
    if (file && !busy) onFile(file);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setHover(false);
    const file = event.dataTransfer?.files?.[0];
    if (file && !busy) onFile(file);
  };

  return (
    <div
      onDragOver={(event): void => {
        event.preventDefault();
        setHover(true);
      }}
      onDragLeave={(): void => setHover(false)}
      onDrop={onDrop}
      className={`rounded-md border-2 border-dashed p-4 text-center text-sm ${
        hover ? 'border-primary bg-primary/5' : 'border-muted-foreground/30'
      }`}
    >
      <input ref={input} type="file" className="hidden" tabIndex={-1} onChange={onChange} />
      <p className="text-muted-foreground">{hint}</p>
      <Button
        type="button"
        variant="outline"
        className="mt-2 min-h-11 sm:min-h-9"
        disabled={busy}
        aria-busy={busy}
        onClick={(): void => input.current?.click()}
      >
        <Upload aria-hidden="true" />
        {label}
      </Button>
    </div>
  );
}
