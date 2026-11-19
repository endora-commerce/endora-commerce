'use client';

import { useId, type ReactElement } from 'react';
import {
  EMAIL_ROW_LAYOUT_PRESETS,
  type EmailRowLayoutPresetId,
} from '@endora-commerce/email-components';
import { Button } from '@endora-commerce/admin-kit/ui';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * The column-layout question asked when a row is dropped on the e-mail canvas.
 *
 * The kit's `ModalDialog` on the `overlay` layer, above the fullscreen builder
 * and its floating action bar: focus trapped, Escape (like *Skip*) keeps the
 * row's default layout, and focus returns to where it was (issue #1493, UX
 * audit CONTENT-03).
 */
export function EmailRowLayoutPicker({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (presetId: EmailRowLayoutPresetId) => void;
}): ReactElement | null {
  const t = useTranslation('core');
  const descriptionId = useId();
  if (!open) return null;

  return (
    <ModalDialog
      layer="overlay"
      title={t('pageBuilder.rowLayout.title')}
      onClose={(): void => onOpenChange(false)}
      widthClassName="max-w-md"
      aria-describedby={descriptionId}
      footer={
        <Button type="button" variant="ghost" onClick={(): void => onOpenChange(false)}>
          {t('pageBuilder.rowLayout.skip')}
        </Button>
      }
    >
      <p id={descriptionId} className="mb-4 text-sm text-muted-foreground">
        {t('pageBuilder.rowLayout.emailDescription')}
      </p>
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
    </ModalDialog>
  );
}
