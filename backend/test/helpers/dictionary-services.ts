import type { EntityManager } from '@mikro-orm/postgresql';
import type { CurrencyReadPort, LanguageReadPort } from '@b2b/contracts';
import { DictionaryValidator } from '../../src/modules/dictionaries/services/dictionary-validator.js';
import { CurrencyReadService } from '../../src/modules/currencies/services/currency-ports.js';
import { LanguageReadService } from '../../src/modules/languages/services/language-ports.js';

/**
 * The two read ports every `dictionaries` service takes — feature 075, Phase C.
 *
 * `dictionaries` owns `countries`, hosts the admin screen and the storefront
 * registry for `currencies` and `languages`, and owns neither of those tables.
 * Since the cut it asks their owners over the published read ports instead of
 * querying them, so a service built by hand needs both.
 *
 * Fourteen tests build one against a bare test database with no container to
 * resolve a port from. This is the one place that wiring is spelled, so a later
 * change to the seam is one edit rather than fourteen — and the implementations
 * are the ones `currencies` and `languages` register, so a test exercises the
 * real read path rather than a stub that cannot disagree with it.
 */
export function dictionaryReadPortsFor(emFactory: () => EntityManager): {
  currencies: CurrencyReadPort;
  languages: LanguageReadPort;
} {
  return {
    currencies: new CurrencyReadService(emFactory),
    languages: new LanguageReadService(emFactory),
  };
}

/** A `DictionaryValidator` over one `EntityManager`, with both read ports. */
export function dictionaryValidatorFor(emFactory: () => EntityManager): DictionaryValidator {
  const ports = dictionaryReadPortsFor(emFactory);
  return new DictionaryValidator(emFactory, ports.currencies, ports.languages);
}
