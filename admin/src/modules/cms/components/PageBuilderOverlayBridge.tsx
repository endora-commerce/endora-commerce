'use client';

import { useEffect, type ReactElement, type ReactNode } from 'react';
import { PageBuilderComponentOverlay } from '@endora-commerce/page-builder-core/editor';
import {
  getHoverActionBarTarget,
  getSelectedActionBarTarget,
  setHoverActionBarTarget,
  setSelectedActionBarTarget,
} from './action-bar-target';

/** Tracks hovered/selected components for the Puck action bar (selected wins over hover). */
export function PageBuilderOverlayBridge({
  children,
  hover,
  isSelected,
  componentId,
  componentType,
}: {
  children: ReactNode;
  hover: boolean;
  isSelected: boolean;
  componentId: string;
  componentType: string;
}): ReactElement {
  useEffect(() => {
    const target = { id: componentId, type: componentType };

    if (isSelected) {
      setSelectedActionBarTarget(target);
    } else if (getSelectedActionBarTarget()?.id === componentId) {
      setSelectedActionBarTarget(null);
    }

    if (hover) {
      setHoverActionBarTarget(target);
    } else if (getHoverActionBarTarget()?.id === componentId) {
      setHoverActionBarTarget(null);
    }
  }, [hover, isSelected, componentId, componentType]);

  return (
    <PageBuilderComponentOverlay
      hover={hover}
      isSelected={isSelected}
      componentId={componentId}
      componentType={componentType}
    >
      {children}
    </PageBuilderComponentOverlay>
  );
}
