import type {
  FederatedSignInOptionsResponse,
  StorefrontModulePresenceResponse,
} from '@b2b/contracts';
import { apiClient } from '../api-client.js';
import type { FederatedProvider } from './resolve.js';

/**
 * The two pre-auth reads behind the federated block — issue #193.
 *
 * Both are **public** endpoints, and they have to be: this runs on the login
 * screen, where there is no session to authenticate with. That is also why
 * presence comes from the storefront projection rather than
 * `/api/v1/admin/module-presence` — the admin one requires an admin session,
 * and `LoginPage` renders outside `<ModulePresenceProvider>` anyway. Presence
 * is not surface-scoped (a module is present platform-wide or not at all), so
 * the two endpoints answer the same question about `mfa`.
 *
 * Both fail **closed**: absent, off, unreachable and not-yet-deployed all
 * answer "no federated route". The password form is unaffected either way, so
 * the closed answer costs an admin nothing they cannot already do — while the
 * open answer costs them a button whose click returns them here with an error.
 */

/** The module id this screen asks about. Not a list — one edge, named once. */
const MFA_MODULE_ID = 'mfa';

export async function fetchMfaPresence(): Promise<boolean> {
  try {
    const res = await apiClient.get<StorefrontModulePresenceResponse>(
      '/api/v1/storefront/module-presence',
    );
    return res.modules.some((m) => m.id === MFA_MODULE_ID && m.present);
  } catch {
    return false;
  }
}

export async function fetchAdminFederatedProviders(): Promise<
  readonly FederatedProvider[]
> {
  try {
    const res = await apiClient.get<FederatedSignInOptionsResponse>(
      '/api/v1/auth/admin/oauth/providers',
    );
    return res.providers;
  } catch {
    return [];
  }
}
