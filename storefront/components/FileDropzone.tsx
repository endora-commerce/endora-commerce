'use client';

import { useRef, useState } from 'react';

/**
 * Drag-and-drop file picker for quick-order import (feature 039, FR-008).
 *
 * Reads the dropped / selected file as base64 into two hidden inputs and
 * submits the enclosing <form>, so all parsing stays on the backend (no
 * client-side CSV/XLSX parser is shipped). Accepts `.csv` and `.xlsx`.
 */
export function FileDropzone({
  filenameField,
  contentField,
  accept = '.csv,.xlsx',
  label = 'Drag a CSV or Excel file here, or click to choose',
}: {
  filenameField: string;
  contentField: string;
  accept?: string;
  label?: string;
}) {
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const filenameRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLInputElement>(null);

  function ingest(file: File): void {
    setBusy(true);
    setName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      const comma = dataUrl.indexOf(',');
      const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : '';
      if (filenameRef.current) filenameRef.current.value = file.name;
      if (contentRef.current) contentRef.current.value = base64;
      setBusy(false);
      filenameRef.current?.form?.requestSubmit();
    };
    reader.onerror = () => setBusy(false);
    reader.readAsDataURL(file);
  }

  return (
    <div>
      <div
        className={`flex cursor-pointer items-center justify-center rounded-md border-2 border-dashed p-[24px] text-center text-[13px] transition ${
          dragging
            ? 'border-accent bg-accent-soft text-accent'
            : 'border-line text-muted hover:border-line-strong'
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
        {busy ? 'Reading file…' : name ? `Selected: ${name}` : label}
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
      <input ref={filenameRef} type="hidden" name={filenameField} />
      <input ref={contentRef} type="hidden" name={contentField} />
    </div>
  );
}
