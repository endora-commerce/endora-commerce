'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { colorPickerDisplayHex } from './color-field-utils.js';

/**
 * Native `<input type="color">` that updates local preview on `input` but only
 * commits to Puck on `change` (when the OS picker closes). React's synthetic
 * `onChange` fires on every drag frame and re-renders the whole canvas.
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

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el || readOnly === true) return undefined;

    const onInput = (ev: Event): void => {
      setDraft((ev.target as HTMLInputElement).value);
    };
    const onChange = (ev: Event): void => {
      const hex = (ev.target as HTMLInputElement).value;
      setDraft(hex);
      onCommit(hex);
    };

    el.addEventListener('input', onInput);
    el.addEventListener('change', onChange);
    return (): void => {
      el.removeEventListener('input', onInput);
      el.removeEventListener('change', onChange);
    };
  }, [onCommit, readOnly]);

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
