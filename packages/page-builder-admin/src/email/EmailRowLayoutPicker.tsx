'use client';

import { createPortal } from 'react-dom';
import type { ReactElement } from 'react';
import {
  EMAIL_ROW_LAYOUT_PRESETS,
  type EmailRowLayoutPresetId,
} from '@endora-commerce/email-components';
import { Button } from '@endora-commerce/admin-kit/ui';

export function EmailRowLayoutPicker({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (presetId: EmailRowLayoutPresetId) => void;
}): ReactElement | null {
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/40 p-4"
      style={{ zIndex: 10000 }}
      role="presentation"
      onPointerDown={(e): void => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div
        className="w-full max-w-md rounded-lg border bg-background p-5 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="email-row-layout-picker-title"
        onPointerDown={(e): void => e.stopPropagation()}
      >
        <div className="mb-4 space-y-1">
          <h2 id="email-row-layout-picker-title" className="text-lg font-semibold">
            Choose column layout
          </h2>
          <p className="text-sm text-muted-foreground">
            Pick how many columns this row should have (max 6). You can change it later from the row
            action bar.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {EMAIL_ROW_LAYOUT_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              type="button"
              variant="outline"
              className="h-auto justify-start py-3"
              onClick={(): void => {
                onSelect(preset.id);
                onOpenChange(false);
              }}
            >
              <span className="font-medium">{preset.label}</span>
            </Button>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="ghost" onClick={(): void => onOpenChange(false)}>
            Skip
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
