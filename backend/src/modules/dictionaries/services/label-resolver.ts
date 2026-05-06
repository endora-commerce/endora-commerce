import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type DictionaryEntryType } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Currency } from '../../currencies/entities/currency.entity.js';
import { Language } from '../../languages/entities/language.entity.js';
import { Country } from '../entities/country.entity.js';
import { DictionaryTranslation } from '../entities/dictionary-translation.entity.js';

export interface ResolveLabelArgs {
  entryType: DictionaryEntryType;
  entryCode: string;
  locale?: string;
}

export class LabelResolver {
  constructor(private readonly emFactory: () => EntityManager) {}

  async resolveLabel(args: ResolveLabelArgs): Promise<string> {
    const em = this.emFactory();
    const canonical = await getCanonicalLabel(em, args.entryType, args.entryCode);
    if (!canonical) throw notFound(args.entryType, args.entryCode);
    if (!args.locale) return canonical;

    const visited = new Set<string>();
    let current: string | null = args.locale;
    for (let depth = 0; current && depth < 10 && !visited.has(current); depth += 1) {
      visited.add(current);
      const translation = await em.findOne(DictionaryTranslation, {
        entryType: args.entryType,
        entryCode: args.entryCode,
        languageCode: current,
      });
      if (translation) return translation.label;

      const language: Language | null = await em.findOne(Language, { code: current });
      current = language?.fallbackCode ?? null;
    }

    return canonical;
  }
}

async function getCanonicalLabel(
  em: EntityManager,
  entryType: DictionaryEntryType,
  entryCode: string,
): Promise<string | null> {
  if (entryType === 'country') {
    return (await em.findOne(Country, { code: entryCode }))?.label ?? null;
  }
  if (entryType === 'currency') {
    return (await em.findOne(Currency, { code: entryCode }))?.label ?? null;
  }
  return (await em.findOne(Language, { code: entryCode }))?.label ?? null;
}

function notFound(entryType: DictionaryEntryType, entryCode: string): HttpError {
  return new HttpError(
    404,
    ERROR_CODES.DICTIONARY_ENTRY_NOT_FOUND,
    `Dictionary ${entryType} ${entryCode} not found.`,
  );
}
