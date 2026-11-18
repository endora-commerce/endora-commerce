import type { PushAudienceCriterionType, PwaDisplayMode } from '@endora-commerce/contracts';
import { defineEnumLabels } from '@endora-commerce/admin-kit/lib';

/**
 * The PWA screen's enum values as the operator reads them (issue #1463, UX
 * audit CONTENT-05, under the pattern of #1434): the manifest's display modes
 * and the push audience's criterion kinds and group operators.
 */
export const displayModeLabels = defineEnumLabels<PwaDisplayMode>({
  standalone: 'settings.displayMode.standalone',
  fullscreen: 'settings.displayMode.fullscreen',
  'minimal-ui': 'settings.displayMode.minimal-ui',
});

/** In the order the criterion select offers them. */
export const criterionTypeLabels = defineEnumLabels<PushAudienceCriterionType>({
  salesChannel: 'audience.criterion.salesChannel',
  customerGroup: 'audience.criterion.customerGroup',
  organization: 'audience.criterion.organization',
  customer: 'audience.criterion.customer',
});

export const groupOperatorLabels = defineEnumLabels<'AND' | 'OR'>({
  AND: 'audience.op.AND',
  OR: 'audience.op.OR',
});
