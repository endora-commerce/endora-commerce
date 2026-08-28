/**
 * The relation target `check-kernel-boundary`'s rule-A proofs point at —
 * a fixture tree of their own (feature 080, T040b).
 *
 * Rule A resolves a relation through the import that declares it and **skips a
 * specifier that does not resolve to a file on disk**, so its red proofs need a
 * target that really exists and that `ownerOf` attributes to a module: a path
 * holding a `/src/modules/<id>/` segment. Every earlier version of those proofs
 * took one out of the application tree — first by name (`catalog`), then by
 * deriving "whichever module under `backend/src/modules` declares an entity" —
 * and both spellings had the same expiry date, because the T040b sweep is in the
 * business of emptying that tree. The derived one died with `_i18n`, the last
 * module in it that owned an entity, and every proof in two files failed at
 * import rather than on what it measures.
 *
 * So the target lives here instead, where nothing about the layout move can
 * reach it. It is not registered, not composed and not compiled into anything:
 * the only thing any reader does with this file is `existsSync` it and take
 * `ownerOf` of its path. The class body is therefore deliberately empty — a
 * decorated entity here would be a second, unregistered `Category` in the tree
 * for `check:singleton-identity` and the ORM alike, bought for a property no
 * reader consults.
 */
export class Category {}
