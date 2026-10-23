import type { PriceBookAudienceKind, PriceBookStatus, PriceBookType } from '@endora-commerce/contracts';
import type { Translate } from './cell-labels.js';

/**
 * A book's type, status and audience kind in words (feature 161, US1). The
 * keys are this module's own bundle's; the list, the create flow and the
 * header name them the same way.
 */
export const BOOK_TYPES: readonly PriceBookType[] = ['regular', 'sale'];
export const BOOK_STATUSES: readonly PriceBookStatus[] = ['draft', 'scheduled', 'active', 'expired'];
export const AUDIENCE_KINDS: readonly PriceBookAudienceKind[] = ['everyone', 'customer_groups', 'organizations'];

export const typeLabel = (t: Translate, type: PriceBookType): string => t(`priceBooks.type.${type}`);
export const typeHelp = (t: Translate, type: PriceBookType): string => t(`priceBooks.type.${type}.help`);
export const statusLabel = (t: Translate, status: PriceBookStatus): string => t(`priceBooks.status.${status}`);
export const audienceLabel = (t: Translate, kind: PriceBookAudienceKind): string => t(`priceBooks.audience.${kind}`);
export const audienceHelp = (t: Translate, kind: PriceBookAudienceKind): string => t(`priceBooks.audience.${kind}.help`);
