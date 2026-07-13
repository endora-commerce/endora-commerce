'use client';

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { Field } from '@measured/puck';
import { useColorPalette } from '../color-palette/context.js';
import { PuckFieldLabel } from './puck-field-label.js';
import {
  colorFieldCommitValue,
  colorFieldDisplayValue,
  colorPickerDisplayHex,
  isTransparentColor,
  isValidHexColor,
  parseColorTextInput,
} from './color-field-utils.js';
import { NativeColorInput } from './native-color-input.js';

const inputClassName = '_Input-input_bsxfo_26';
const controlHeightClass = 'h-9';
const DEBOUNCE_MS = 250;

function ColorFieldControl({
  value,
  onChange,
  readOnly,
  label,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  readOnly?: boolean | undefined;
  label: string;
}): ReactElement {
  const palette = useColorPalette();
  const committedDisplay = colorFieldDisplayValue(value);
  const [draft, setDraft] = useState(committedDisplay);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDraft(colorFieldDisplayValue(value));
  }, [value]);

  const flushDebounce = useCallback((): void => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const commit = useCallback(
    (next: string): void => {
      flushDebounce();
      const display = colorFieldDisplayValue(next === 'transparent' ? undefined : next);
      const committed = colorFieldCommitValue(next);
      setDraft(display);
      onChange(committed);
    },
    [flushDebounce, onChange],
  );

  const scheduleCommit = useCallback(
    (next: string): void => {
      flushDebounce();
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        const committed = colorFieldCommitValue(next);
        const currentCommitted = colorFieldCommitValue(value ?? '');
        if (committed !== currentCommitted) {
          onChange(committed);
        }
      }, DEBOUNCE_MS);
    },
    [flushDebounce, onChange, value],
  );

  useEffect(() => (): void => flushDebounce(), [flushDebounce]);

  const onTextChange = (raw: string): void => {
    const parsed = parseColorTextInput(raw);
    setDraft(parsed.display);
    if (parsed.commit !== undefined || parsed.display === '') {
      commit(parsed.commit ?? 'transparent');
      return;
    }
    scheduleCommit(parsed.display);
  };

  const onTextBlur = (): void => {
    flushDebounce();
    if (isValidHexColor(draft)) {
      commit(draft);
      return;
    }
    if (isTransparentColor(draft)) {
      commit('transparent');
      return;
    }
    setDraft(committedDisplay);
  };

  return (
    <PuckFieldLabel label={label} {...(readOnly === true ? { readOnly: true } : {})}>
      <div className={`flex items-center gap-2 ${controlHeightClass}`}>
        <NativeColorInput
          className={`${controlHeightClass} w-12 shrink-0 cursor-pointer rounded border border-border p-0.5`}
          readOnly={readOnly}
          value={colorPickerDisplayHex(draft)}
          onCommit={(hex): void => commit(hex)}
        />
        <input
          type="text"
          className={`${inputClassName} ${controlHeightClass}`}
          style={{ flex: 1, boxSizing: 'border-box' }}
          readOnly={readOnly}
          value={draft}
          placeholder="transparent"
          onChange={(e): void => onTextChange(e.target.value)}
          onBlur={onTextBlur}
        />
        {palette ? (
          <button
            type="button"
            className={`${controlHeightClass} shrink-0 cursor-pointer rounded border border-border px-2 text-xs`}
            disabled={readOnly === true}
            onClick={(): void => palette.openPalette((hex) => commit(hex))}
          >
            Palette
          </button>
        ) : null}
      </div>
    </PuckFieldLabel>
  );
}

export function createColorField(options: { label: string }): Field<string | undefined, Record<string, unknown>> {
  return {
    type: 'custom',
    label: options.label,
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <ColorFieldControl
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        label={field.label ?? options.label}
      />
    ),
  };
}
