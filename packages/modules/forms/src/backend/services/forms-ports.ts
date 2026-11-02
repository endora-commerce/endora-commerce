import type {
  AdminI18nTranslatePort,
  CmsPageReadPort,
  CustomerAccountReadPort,
  DictionaryValidator,
  EmailMailerPort,
} from '@endora-commerce/contracts';
import type { SalesChannelResolutionPort, SettingsReadPort } from '@endora-commerce/platform/kernel';

/**
 * The foreign ports this module reads, each a `lazyPort` resolved **per call** in the composition
 * file (`../index.ts`) — never captured into a singleton, so a gate keeps answering for its owner's
 * current state (`specs/conventions/module-composition.md` item 3). Contract types only.
 *
 * `cms` is switchable and this module only *degrades* without it (the manifest's
 * `degrades-without` edge): a caller asks {@link FormsPorts.cmsPresent} **in front of** the gate and
 * answers the confirmation message without it; nothing here catches a refusal.
 */
export interface FormsPorts {
  /** `email` — the shop notification and the confirmation (research R-13). */
  readonly mailer: EmailMailerPort;
  /** `_i18n` — validation messages and e-mail wording in the reader's language (R-24). */
  readonly i18n: AdminI18nTranslatePort;
  /** `customer_accounts` — attribution and the anonymisation reconciliation (R-17). */
  readonly customerAccounts: CustomerAccountReadPort;
  /** `dictionaries` — country answers (FR-028). */
  readonly dictionary: DictionaryValidator;
  /**
   * `sales_channels` — the channels and the languages they serve: the storefront languages a form
   * may be written in, the builder's warnings (FR-018) and the submission's channel (FR-035).
   */
  readonly channels: SalesChannelResolutionPort;
  /** `settings` — the CAPTCHA provider and keys, read per verification (R-14). */
  readonly settings: SettingsReadPort;
  /** `cms` — a "show a CMS page" confirmation's path; only after {@link cmsPresent}. */
  readonly cmsPages: CmsPageReadPort;
  /** Whether `cms` is effectively present, decided before {@link cmsPages} is asked. */
  readonly cmsPresent: () => boolean;
}
