'use client';

import type { ReactElement, ReactNode } from 'react';

function humanizeComponentType(type: string): string {
  return type.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/**
 * Puck component overlay — shows a small type badge on hover/selection so
 * adjacent blocks are easier to distinguish while dragging.
 */
export function PageBuilderComponentOverlay({
  children,
  hover,
  isSelected,
  componentType,
}: {
  children: ReactNode;
  hover: boolean;
  isSelected: boolean;
  componentId: string;
  componentType: string;
}): ReactElement {
  const showLabel = hover || isSelected;

  return (
    <div className="pb-component-overlay">
      {children}
      {showLabel ? (
        <span className="pb-component-overlay__label">{humanizeComponentType(componentType)}</span>
      ) : null}
    </div>
  );
}
