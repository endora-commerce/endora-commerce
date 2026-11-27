import type { FieldFormat } from '@endora-commerce/contracts';

/**
 * The platform formats' server validators (`specs/193-admin-form-extensions/`
 * FR-033, `contracts/input-controls.md` §1). Their client twins are admin-kit's;
 * both are held to `FIELD_FORMAT_VECTORS` (`@endora-commerce/contracts/admin-forms.vectors`),
 * deliberately the clear cases only.
 */

/** `local@domain.tld`: no whitespace, one `@`, a dot in the domain. */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u;
/** Digits, spaces, hyphens and parentheses, after at most one leading `+`. */
const TEL_RE = /^\+?[0-9() -]+$/u;
const COUNTRY_RE = /^[A-Z]{2}$/u;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/u;

function isTel(value: string): boolean {
  if (!TEL_RE.test(value)) return false;
  const digits = value.replace(/\D/gu, '').length;
  return digits >= 7 && digits <= 15;
}

function isUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.length > 0;
}

export const PLATFORM_FORMAT_VALIDATORS: Readonly<Record<FieldFormat, (value: string) => boolean>> = {
  email: (value) => EMAIL_RE.test(value),
  tel: isTel,
  url: isUrl,
  // ISO 3166-1 alpha-2, upper case. The shape only: the dictionary of
  // countries is `dictionaries`', and a deployment narrows with `options`.
  country: (value) => COUNTRY_RE.test(value),
  color: (value) => COLOR_RE.test(value),
};

export function isPlatformFormat(id: string): id is FieldFormat {
  return Object.prototype.hasOwnProperty.call(PLATFORM_FORMAT_VALIDATORS, id);
}

/**
 * One validator over the platform formats and the composition's module
 * formats. A format nobody validates answers `false`: the seal refuses one
 * before it can reach a write (`format-without-validator`), so this is only
 * ever the fail-closed answer to a composition that skipped the seal.
 */
export function formatValidator(
  moduleFormats: ReadonlyMap<string, { readonly validate: (value: string) => boolean }>,
): (format: string, value: string) => boolean {
  return (format, value) => {
    if (isPlatformFormat(format)) return PLATFORM_FORMAT_VALIDATORS[format](value);
    return moduleFormats.get(format)?.validate(value) ?? false;
  };
}
