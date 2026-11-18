/**
 * Where a visitor goes after a step that took them away from the page they asked for — the
 * sign-in's `next`, the guest complaint entry's `from` (`specs/181-guest-complaints/` design
 * review F-22). One rule, so the sign-in pages and the guest entry cannot disagree on what
 * may leave the shop: a same-origin path is kept, anything else — an absolute URL, `//host`,
 * `/\host`, nothing at all — is the fallback.
 */
export function sanitiseNext(input: string | null | undefined, fallback = '/account'): string {
  if (!input) return fallback;
  if (!input.startsWith('/') || input.startsWith('//') || input.startsWith('/\\')) return fallback;
  return input;
}
