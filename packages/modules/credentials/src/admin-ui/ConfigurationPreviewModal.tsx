import { type ReactNode } from 'react';
import type { ConfigurationDto } from '@endora-commerce/contracts';
import { Button } from '@endora-commerce/admin-kit/ui';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
/**
 * Read-only preview of a credential configuration (feature 058 US1).
 *
 * The kit's `ModalDialog` (issue #1444, DS-11) — named by its title, focus
 * held inside and returned to *Preview*, Escape to close. Secrets are shown
 * only as "set / not set" — never a value (SC-003).
 */
export interface ConfigurationPreviewModalProps {
  open: boolean;
  configuration: ConfigurationDto | null;
  onClose: () => void;
}

export function ConfigurationPreviewModal({
  open,
  configuration,
  onClose,
}: ConfigurationPreviewModalProps): ReactNode {
  const t = useTranslation('credentials');
  const tc = useTranslation('core');
  if (!open || !configuration) return null;

  return (
    <ModalDialog
      title={t('preview.title')}
      onClose={onClose}
      widthClassName="max-w-md"
      footer={
        <Button variant="outline" onClick={onClose}>
          {tc('common.action.close')}
        </Button>
      }
    >
      <p className="mb-4 text-sm text-muted-foreground">
        {configuration.name} · {configuration.typeLabel ?? configuration.typeCode} /{' '}
        {configuration.providerLabel ?? configuration.providerCode}
      </p>

      {configuration.inert ? (
        <p className="text-sm text-destructive">{t('form.inert')}</p>
      ) : (
        <dl className="space-y-2">
          {configuration.fields.map((f) => (
            <div key={f.key} className="flex items-center justify-between gap-4 text-sm">
              <dt className="text-muted-foreground">{f.key}</dt>
              <dd className="font-medium">
                {f.secret
                  ? f.isSet
                    ? t('preview.secret')
                    : t('preview.notSet')
                  : String(f.value ?? '')}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </ModalDialog>
  );
}
