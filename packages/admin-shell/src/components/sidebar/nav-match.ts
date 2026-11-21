/**
 * Whether a sidebar row must match its route exactly (`NavLink`'s `end`).
 *
 * A row lights up for the screens beneath it — a module's `/x/new` and `/x/:id`
 * have no row of their own and never will — **unless the operator is on a more
 * specific sibling row**, which is then the only one lit. The home row (`/`)
 * is a prefix of everything, so it always matches exactly.
 *
 * Until issue #1550 the rule was "exact whenever a nested sibling *exists*".
 * That held while every sub-screen of a parent row had a row of its own, and
 * broke the moment one did not: `settings` folded Groups and Cache into a tab
 * strip under its one `/settings` row, `pwa` still contributes `/settings/pwa`
 * to the same section, and `/settings/groups` lit no row at all. Asking whether
 * the nested sibling is the *active* one is the longest-match rule
 * `registryCrumbs` and `RouteTabs` already follow.
 */
export function navItemMatchesExactly(
  itemTo: string,
  sectionTargets: readonly string[],
  pathname: string,
): boolean {
  if (itemTo === '/') return true;
  const nestedPrefix = `${itemTo}/`;
  return sectionTargets.some(
    (other) =>
      other !== itemTo &&
      other.startsWith(nestedPrefix) &&
      (pathname === other || pathname.startsWith(`${other}/`)),
  );
}
