import { useRef, useState, type ReactNode } from 'react';

/**
 * Drag-and-drop file picker (feature 039). Reads the dropped / selected file
 * as base64 and hands it to `onFile`; all parsing stays on the backend.
 */
export function FileDropzone({
  onFile,
  accept = '.csv,.xlsx',
  label = 'Drag a CSV or Excel file here, or click to choose',
}: {
  onFile: (filename: string, contentBase64: string) => void;
  accept?: string;
  label?: string;
}): ReactNode {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  function ingest(file: File): void {
    setName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      const comma = dataUrl.indexOf(',');
      onFile(file.name, comma >= 0 ? dataUrl.slice(comma + 1) : '');
    };
    reader.readAsDataURL(file);
  }

  return (
    <div>
      <div
        className={`rounded-md border-2 border-dashed p-6 text-center text-sm cursor-pointer ${
          dragging ? 'border-primary bg-muted' : 'border-muted-foreground/30'
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) ingest(file);
        }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        role="button"
        tabIndex={0}
      >
        {name ? `Selected: ${name}` : label}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) ingest(file);
        }}
      />
    </div>
  );
}
