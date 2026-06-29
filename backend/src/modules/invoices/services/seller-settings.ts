import { z } from 'zod';
import { HttpError } from '../../../http/error-envelope.js';
import { ERROR_CODES } from '@b2b/contracts';
import { sellerCompanyDataSchema, type SellerCompanyData } from '@b2b/contracts';
import { INVOICES_SETTING_CODES } from '../manifest.js';

export interface SettingsReader {
  get<T>(code: string, salesChannelId: string, schema: z.ZodType<T>): Promise<T>;
}

/**
 * Resolves the seller (own company) data + VAT/NIP from settings for a sales
 * channel and merges them. Throws an actionable 422 when the minimum required
 * fields are missing so issuance never produces an invalid document (FR-006).
 */
export class SellerSettingsResolver {
  constructor(private readonly settings: SettingsReader) {}

  async resolve(salesChannelId: string): Promise<SellerCompanyData> {
    let taxId = '';
    let raw: unknown = {};
    try {
      taxId = await this.settings.get(INVOICES_SETTING_CODES.SELLER_TAX_ID, salesChannelId, z.string());
    } catch {
      taxId = '';
    }
    try {
      raw = await this.settings.get(
        INVOICES_SETTING_CODES.SELLER_COMPANY_DATA,
        salesChannelId,
        z.record(z.string(), z.unknown()),
      );
    } catch {
      raw = {};
    }

    const parsed = sellerCompanyDataSchema.safeParse({ ...(raw as object), taxId: taxId || (raw as { taxId?: string }).taxId });
    if (!parsed.success || !parsed.data.legalName || !parsed.data.taxId) {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'Seller VAT/NIP and company data must be configured before issuing invoices.',
        { setting: 'invoices.seller.company_data' },
      );
    }
    return parsed.data;
  }
}
