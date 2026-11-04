/**
 * The landing ledger of the roles upgrade's expected differences —
 * `specs/170-organization-roles/` T130 (WP-13a; research R-38;
 * `contracts/migration-and-replay.md` §6.2).
 *
 * Which of the three work packages that move a §6.1 row have merged into the
 * integration branch. `roles-upgrade-replay.test.ts` reads it: a row of
 * `EXPECTED_DIFFERENCES` must equal its `after` once its `landedBy` package is
 * `true` here and its `before` while it is `false`; every other row equals
 * `PRE_UPGRADE_OUTCOMES`. `WP-03`'s entry also switches the replay's request
 * bodies from the legacy `role` to `roleId` (`roleToRoleId`), because WP-03 is
 * the package that changes that API shape.
 *
 * **The package named flips its own entry, in its own merge request, and in no
 * other.** One entry per line with a comment line between them, so the three
 * packages' edits never touch adjacent lines. WP-13 deletes this file and the
 * replay's interim comparison with it.
 */
export const LANDED: Readonly<Record<'WP-03' | 'WP-04' | 'WP-06', boolean>> = {
  // WP-03 — §6.1 rows 1, 2, 8–13 (P.owner's membership and MFA routes), 25, 26 (expired invitations unlisted); bodies through `roleToRoleId`
  'WP-03': false,
  // WP-04 — §6.1 rows 3–6 (P.owner's organization carts), 14–21 (organization-cart refusal code), 22 (self-submit code)
  'WP-04': false,
  // WP-06 — §6.1 rows 7 (P.owner's one-click defaults), 23, 24 (one-click in an approval-requiring Organization, #653)
  'WP-06': false,
};
