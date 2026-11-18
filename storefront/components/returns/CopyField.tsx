'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The guest's tracking link on the success page (`specs/181-guest-complaints/` design review
 * S-6): a read-only, selectable input — the only way to take the link without JavaScript,
 * and a long-press select on a phone where the clipboard API is refused — and, once hydrated,
 * *Copy link*.
 *
 * The result is said in a `role="status"` region mounted empty, and it **stays**: a
 * screen-reader user needs it to still be there when they look (the compare page's share
 * button reverts after 1.5 s; this one does not). When the clipboard refuses, the status says
 * so and the link is focused and selected for a manual copy. Not a site-wide primitive: it
 * lives beside the returns components that need it.
 */
export function CopyField({
  id,
  value,
  label,
  copy,
  copied,
  failed,
}: {
  id: string;
  value: string;
  label: string;
  copy: string;
  copied: string;
  failed: string;
}): ReactNode {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  // Without JavaScript the button would do nothing, so it is rendered after hydration only.
  const [enhanced, setEnhanced] = useState(false);
  useEffect(() => setEnhanced(true), []);
  const selectAll = (): void => {
    input.current?.focus();
    input.current?.select();
  };
  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
      selectAll();
    }
  };
  return (
    <div className="b2b-auth__field">
      <label htmlFor={id}>{label}</label>
      <input
        ref={input}
        id={id}
        readOnly
        value={value}
        onFocus={(event) => event.currentTarget.select()}
        className="w-full font-mono text-[13px]"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {enhanced ? (
          <button type="button" className="btn btn--primary" onClick={() => void onCopy()}>
            {copy}
          </button>
        ) : null}
        <span role="status" className="text-[13px]">
          {state === 'copied' ? copied : state === 'failed' ? failed : ''}
        </span>
      </div>
    </div>
  );
}
