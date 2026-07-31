'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { colorPickerDisplayHex } from './color-field-utils.js';
import { createDebouncedColorCommit } from './color-input-debounce.js';

const DEBOUNCE_MS = 200;

/**
 * Native `<input type="color">` with debounced live preview on `input` and an
 * immediate commit on `change` (when the OS picker closes).
 */
export function NativeColorInput({
  value,
  onCommit,
  readOnly,
  className,
}: {
  value: string;
  onCommit: (hex: string) => void;
  readOnly?: boolean | undefined;
  className?: string;
}): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  const debounceRef = useRef<ReturnType<typeof createDebouncedColorCommit> | null>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    debounceRef.current = createDebouncedColorCommit((hex) => onCommitRef.current(hex), DEBOUNCE_MS);
    return (): void => {
      debounceRef.current?.dispose();
      debounceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const el = inputRef.current;
    if (!el || readOnly === true) return undefined;

    const onInput = (ev: Event): void => {
      const hex = (ev.target as HTMLInputElement).value;
      setDraft(hex);
      debounceRef.current?.schedule(hex);
    };

    const onChange = (ev: Event): void => {
      const hex = (ev.target as HTMLInputElement).value;
      setDraft(hex);
      debounceRef.current?.commitNow(hex);
    };

    el.addEventListener('input', onInput);
    el.addEventListener('change', onChange);
    return (): void => {
      debounceRef.current?.dispose();
      el.removeEventListener('input', onInput);
      el.removeEventListener('change', onChange);
    };
  }, [readOnly]);

  return (
    <input
      ref={inputRef}
      type="color"
      className={className}
      disabled={readOnly === true}
      value={colorPickerDisplayHex(draft)}
    />
  );
}
