/**
 * `?returnTo=` — where a screen opened from elsewhere leads back to.
 *
 * The screen that links names the way back; the screen that is opened reads
 * it and says only "Back". Neither knows what the other is: a detail screen
 * does not know which module's screen opened it, only that there is a path to
 * return to. The create screens of Orders and Quote Requests have read the
 * same parameter for a while; their detail screens read it through here.
 *
 * The value is a path of this application only — never a scheme, a host or
 * `//` — so a crafted link cannot send the Back button anywhere else.
 */

export const RETURN_TO_PARAM = 'returnTo';

const IN_APP_PATH = /^\/(?![/\\])/;

/**
 * The return address a query names, or `null` when it names none this application would follow.
 *
 * `param` names another parameter read by the same rule — `/login?next=` (issue #859).
 */
export function readReturnTo(params: URLSearchParams, param: string = RETURN_TO_PARAM): string | null {
  const value = params.get(param) ?? '';
  return IN_APP_PATH.test(value) ? value : null;
}

/** `target` with `returnTo` added to its query — or unchanged, for an address `readReturnTo` would refuse. */
export function withReturnTo(target: string, returnTo: string): string {
  if (!IN_APP_PATH.test(returnTo)) return target;
  const hashAt = target.indexOf('#');
  const hash = hashAt === -1 ? '' : target.slice(hashAt);
  const withoutHash = hashAt === -1 ? target : target.slice(0, hashAt);
  const queryAt = withoutHash.indexOf('?');
  const path = queryAt === -1 ? withoutHash : withoutHash.slice(0, queryAt);
  const params = new URLSearchParams(queryAt === -1 ? '' : withoutHash.slice(queryAt + 1));
  params.set(RETURN_TO_PARAM, returnTo);
  return `${path}?${params.toString()}${hash}`;
}
