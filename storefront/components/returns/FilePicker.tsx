'use client';

import { useEffect, useState, type ReactNode } from 'react';

/**
 * One file control in the shop's language (`specs/180-off-platform-complaints/`, the case
 * page's *Add a file*). The native control's button and "no file chosen" speak the browser's
 * language, so once JavaScript runs the input is visually hidden — still focusable and still
 * posted with the form — behind the page's own button and the chosen file's name. Without
 * JavaScript it is the native control.
 */
export function FilePicker({
  id,
  name,
  accept,
  chooseLabel,
  noneLabel,
  describedBy,
  required = false,
}: {
  id: string;
  name: string;
  accept: string;
  chooseLabel: string;
  noneLabel: string;
  describedBy?: string;
  required?: boolean;
}): ReactNode {
  const [enhanced, setEnhanced] = useState(false);
  const [chosen, setChosen] = useState('');
  useEffect(() => setEnhanced(true), []);
  return (
    <>
      <input
        id={id}
        name={name}
        type="file"
        required={required}
        accept={accept}
        {...(describedBy ? { 'aria-describedby': describedBy } : {})}
        {...(enhanced ? { className: 'sr-only' } : {})}
        onChange={(event) => setChosen(event.target.files?.[0]?.name ?? '')}
      />
      {enhanced ? (
        <span className="flex flex-wrap items-center gap-3">
          <label htmlFor={id} className="b2b-stacked__pick">
            {chooseLabel}
          </label>
          <span className="text-[13px] text-muted" aria-live="polite">
            {chosen || noneLabel}
          </span>
        </span>
      ) : null}
    </>
  );
}
