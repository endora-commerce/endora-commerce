import { useEffect, useState, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { AdminZoneProps } from '@endora-commerce/contracts';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription } from '@endora-commerce/admin-kit/ui';
import { GUS_CREDENTIALS_SETTING_CODE, credentialReferenceOf, showPlSourcesWarning } from './pl-sources-warning.js';

/**
 * "With `gus` and no GUS credential, Polish NIPs cannot be looked up at all" —
 * `organizations`' contribution to `settings.setting.after`, matched to
 * `organizations.registration.registry_lookup_pl_sources` (feature 173,
 * `contracts/admin-surfaces.md` §2a; FR-026a).
 *
 * The decision is {@link showPlSourcesWarning}; this reads the stored GUS
 * credential reference through the settings admin API the screen already uses
 * (`settings:read`) each time the draft becomes `gus`, so a credential selected
 * on its own row a moment ago is seen. A read failure shows nothing — the
 * setting's description still warns — and nothing here can block a save.
 */
export type PlSourcesWarningProps = AdminZoneProps<'settings.setting.after'>;

export function PlSourcesWarning({ settingCode, draftText }: PlSourcesWarningProps): ReactNode {
  const t = useTranslation('organizations');
  const draft = draftText ?? '';
  const wantsGus = draft.trim() === 'gus';
  const [credentialReference, setCredentialReference] = useState<string | null>(null);

  useEffect(() => {
    if (!wantsGus) return;
    let cancelled = false;
    setCredentialReference(null);
    apiClient
      .get<unknown>(`/api/v1/admin/settings/${encodeURIComponent(GUS_CREDENTIALS_SETTING_CODE)}`)
      .then((answer) => {
        if (!cancelled) setCredentialReference(credentialReferenceOf(answer));
      })
      .catch(() => {
        if (!cancelled) setCredentialReference(null);
      });
    return () => {
      cancelled = true;
    };
  }, [wantsGus]);

  const visible = showPlSourcesWarning({ settingCode, draftText: draft, credentialReference });

  // Mounted empty so the warning is announced when it appears (WCAG 4.1.3).
  return (
    <div role="status" aria-live="polite" className="empty:!mt-0">
      {visible ? (
        <Alert
          role="presentation"
          variant="warning"
          className="mt-1 px-3 py-2 [&>svg]:left-3 [&>svg]:top-2.5"
          data-notice="registry-lookup-pl-sources-without-gus"
        >
          <TriangleAlert aria-hidden="true" className="h-4 w-4" />
          <AlertDescription className="text-xs">{t('settingsWarning.plSourcesGusWithoutCredential')}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

/** The default export the zone declaration's dynamic-import factory resolves. */
export default PlSourcesWarning;
