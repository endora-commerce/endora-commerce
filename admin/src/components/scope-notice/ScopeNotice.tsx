import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ScopeNoticeCode } from '@endora-commerce/contracts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Why a listing is empty, when "empty" and "there is nothing" are different
 * statements (feature 087, owner decision of 2026-08-29).
 *
 * A viewer whose access is limited to particular organizations is shown none of
 * the records in a table that carries no organization at all. The refusal is
 * correct; the silence was not — an operator reading zero rows concludes
 * something false about the **data**, and there is no way for them to find out
 * otherwise. The server says which of the two it meant (`meta.scopeNotice`) and
 * this renders the sentence.
 *
 * **One component rather than three strings.** The three screens it serves
 * today (`/comparisons`, `/newsletter/subscribers`,
 * `/inventory/availability-notifications`) are all of the surfaces in this
 * state, and feature 087's Group B adds four more when its columns land in the
 * opposite direction. A per-screen sentence is seven copies of one paragraph,
 * which is seven places to correct it and seven chances for one of them to keep
 * saying something that has stopped being true. The copy lives in the `core`
 * bundle for the same reason: it belongs to no module.
 *
 * It renders **nothing** when there is no notice, so a screen may mount it
 * unconditionally in its empty branch. That is deliberate — the caller does not
 * have to know when the sentence applies, and an unrestricted viewer, whose
 * responses never carry the code, never sees it.
 */
export interface ScopeNoticeProps {
  /** The code from the response envelope, or `null` when it carried none. */
  notice: ScopeNoticeCode | null | undefined;
}

export function ScopeNotice({ notice }: ScopeNoticeProps): ReactNode {
  const t = useTranslation('core');
  if (notice !== 'ORGANIZATION_ATTRIBUTION_PENDING') return null;
  return (
    <Alert>
      <Info className="size-4" />
      <AlertTitle>{t('scopeNotice.organizationAttributionPending.title')}</AlertTitle>
      <AlertDescription>
        {t('scopeNotice.organizationAttributionPending.body')}
      </AlertDescription>
    </Alert>
  );
}
