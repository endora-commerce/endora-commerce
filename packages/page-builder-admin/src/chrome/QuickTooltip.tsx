'use client';

import {
  cloneElement,
  isValidElement,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

const SHOW_DELAY_MS = 200;

/** Faster than the native `title` tooltip (typically ~1s). */
export function QuickTooltip({
  text,
  children,
}: {
  text: string;
  children: ReactElement;
}): ReactElement {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = (): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
  };

  const hide = (): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  };

  const child = isValidElement<{ label?: string; title?: string }>(children)
    ? cloneElement(children, { title: '' })
    : children;

  return (
    <span
      className="pb-quick-tooltip-host"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {child}
      {visible ? (
        <span className="pb-quick-tooltip" role="tooltip">
          {text}
        </span>
      ) : null}
    </span>
  );
}

export function wrapQuickTooltip(node: ReactNode, key?: string): ReactNode {
  if (!isValidElement(node)) return node;
  const props = node.props as { label?: string };
  const label = typeof props.label === 'string' ? props.label : undefined;
  if (!label) return node;
  return (
    <QuickTooltip key={key ?? label} text={label}>
      {node}
    </QuickTooltip>
  );
}
