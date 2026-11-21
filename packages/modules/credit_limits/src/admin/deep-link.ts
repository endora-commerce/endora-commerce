/**
 * The address that opens the Credit limits screen with the grant / adjust
 * dialog for one organization (issue #1544): what the Organization screen's
 * credit-limit panel links to. The screen reads it back with
 * {@link deepLinkedOrganization} and drops the parameter when the dialog closes.
 */
export const DEEP_LINK_PARAM = 'organizationId';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function creditLimitDeepLink(organizationId: string): string {
  return `/credit-limits?${DEEP_LINK_PARAM}=${encodeURIComponent(organizationId)}`;
}

/** The organization a deep link names, or `null` when it names none or something that is not an id. */
export function deepLinkedOrganization(search: URLSearchParams): string | null {
  const value = search.get(DEEP_LINK_PARAM)?.trim();
  return value && UUID.test(value) ? value : null;
}
