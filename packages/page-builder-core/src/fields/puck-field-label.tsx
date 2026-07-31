'use client';

import { FieldLabel } from '@measured/puck';
import type { ReactElement, ReactNode } from 'react';

/** Puck does not render `field.label` for custom fields — wrap controls explicitly. */
export function PuckFieldLabel({
  label,
  readOnly,
  children,
}: {
  label: string;
  readOnly?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <FieldLabel label={label} {...(readOnly === true ? { readOnly: true } : {})}>
      {children}
    </FieldLabel>
  );
}
