import type { EmailBlockSummary } from '@endora-commerce/contracts';
import { defineEnumLabels } from '@endora-commerce/admin-kit/lib';

/**
 * Where an e-mail block or template applies, as the operator reads it (issue
 * #1463, UX audit CONTENT-05, under the pattern of #1434) — never the
 * `global` / `channel` code the API sends.
 */
export const emailScopeLabels = defineEnumLabels<EmailBlockSummary['scope']>({
  global: 'scope.global',
  channel: 'scope.channel',
});
