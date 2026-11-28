/**
 * The platform formats' client twins (`specs/193-admin-form-extensions/`
 * `contracts/input-controls.md` §1, FR-033). The server validators are the
 * platform's (`kernel/forms/formats.ts`); both are held to the contracts'
 * `FIELD_FORMAT_VECTORS`, so the form refuses what the server refuses.
 *
 * A **module** format (`<moduleId>.<name>`) has its validator in that module's
 * backend only, so the client cannot judge it: `null`, and the server answers.
 */
import { FIELD_FORMATS, type FieldFormat } from '@endora-commerce/contracts';

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

const CHECKS: Readonly<Record<FieldFormat, (value: string) => boolean>> = {
  email: (value) => EMAIL_RE.test(value),
  tel: isTel,
  url: isUrl,
  country: (value) => COUNTRY_RE.test(value),
  color: (value) => COLOR_RE.test(value),
};

const isPlatformFormat = (format: string): format is FieldFormat => (FIELD_FORMATS as readonly string[]).includes(format);

/**
 * Whether `value` is in `format`: `true` or `false` for a platform format,
 * `null` for a module format, which only its module's backend can judge.
 */
export function checkPlatformFieldFormat(format: string, value: string): boolean | null {
  return isPlatformFormat(format) ? CHECKS[format](value) : null;
}
