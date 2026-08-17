import type {
  CurrencyAdminPort,
  CurrencyReadPort,
  CurrencyRecord,
} from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Currency } from '../entities/currency.entity.js';
import type { CurrencyService } from './currency-service.js';

/**
 * The published face of `currencies` (feature 075, Phase P).
 *
 * The delivery-side twin of `languages`' ports, and the same split: six of the
 * fifteen inbound sites read the `Currency` **entity** — `dictionaries`
 * resolving a label or validating a code — and the rest type themselves
 * against `CurrencyService`.
 */
export class CurrencyReadService implements CurrencyReadPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async list(): Promise<CurrencyRecord[]> {
    const rows = await this.emFactory().find(
      Currency,
      {},
      { orderBy: { sortOrder: 'asc', code: 'asc' } },
    );
    return rows.map(toCurrencyRecord);
  }

  async listActive(): Promise<CurrencyRecord[]> {
    const rows = await this.emFactory().find(
      Currency,
      { isActive: true },
      { orderBy: { sortOrder: 'asc', code: 'asc' } },
    );
    return rows.map(toCurrencyRecord);
  }

  async getDefault(): Promise<CurrencyRecord | null> {
    const row = await this.emFactory().findOne(Currency, { isDefault: true });
    return row ? toCurrencyRecord(row) : null;
  }

  async findByCode(code: string): Promise<CurrencyRecord | null> {
    const row = await this.emFactory().findOne(Currency, { code });
    return row ? toCurrencyRecord(row) : null;
  }
}

export function createCurrencyAdminPort(getService: () => CurrencyService): CurrencyAdminPort {
  return {
    async create(input) {
      return toCurrencyRecord(await getService().create(input));
    },
    async upsert(input) {
      return toCurrencyRecord(await getService().upsert(input));
    },
    async update(code, input) {
      return toCurrencyRecord(await getService().update(code, input));
    },
    async setDefault(code) {
      return toCurrencyRecord(await getService().setDefault(code));
    },
    remove: (code) => getService().remove(code),
  };
}

export function toCurrencyRecord(currency: Currency): CurrencyRecord {
  return {
    code: currency.code,
    label: currency.label,
    symbol: currency.symbol,
    symbolPosition: currency.symbolPosition,
    decimalPlaces: currency.decimalPlaces,
    isDefault: currency.isDefault,
    isActive: currency.isActive,
    sortOrder: currency.sortOrder,
    createdAt: currency.createdAt,
    updatedAt: currency.updatedAt,
  };
}
