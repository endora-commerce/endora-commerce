import { type ReactNode } from 'react';
import type { ConfigurationDto } from '@endora-commerce/contracts';
import { Button } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
/**
 * Read-only preview of a credential configuration (feature 058 US1).
 *
 * Hand-rolled overlay mirroring the `OrdersBulkStatusDialog` convention (no
 * shared Dialog primitive exists). Secrets are shown only as "set / not set" —
 * never a value (SC-003).
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
  if (!open || !configuration) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-lg">
        <h2 className="mb-1 text-lg font-semibold">{t('preview.title')}</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          {configuration.name} · {configuration.typeLabel ?? configuration.typeCode} /{' '}
          {configuration.providerLabel ?? configuration.providerCode}
        </p>

        {configuration.inert ? (
          <p className="mb-4 text-sm text-destructive">{t('form.inert')}</p>
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

        <div className="mt-6 flex justify-end">
          <Button variant="outline" onClick={onClose}>
            {t('action.cancel')}
          </Button>
        </div>
      </div>
    </div>
  );
}
