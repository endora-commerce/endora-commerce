import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from './ui/alert.js';
import { useTranslation } from '../i18n/useTranslation.js';

/**
 * Tells a signed-in administrator that the account holds no role (issue #140).
 *
 * Such an account is refused on every permission-gated route with
 * `403 ADMIN_ROLE_REQUIRED`, while `GET /api/v1/admin/me` still answers 200
 * with `role: null`. The shell therefore mounts, every gated surface filters
 * itself out, and the sentence carried by that 403 is never fetched because no
 * page is left to fetch it. This states it without waiting for a refusal.
 *
 * `Alert` renders `role="alert"`, so the notice is announced as well as shown.
 * It carries no action: the remedy is another administrator's, or the command
 * line's, and a role-less session can perform neither.
 */
export function RoleRequiredNotice(): ReactNode {
  const t = useTranslation('core');
  return (
    <Alert variant="warning" className="mb-4">
      <ShieldAlert className="size-4" aria-hidden="true" />
      <div>
        <AlertTitle>{t('appShell.noRole.title')}</AlertTitle>
        <AlertDescription>{t('appShell.noRole.description')}</AlertDescription>
      </div>
    </Alert>
  );
}
