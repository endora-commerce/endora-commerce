/**
 * Module capabilities — declared membership of a named family
 * (`specs/132-connector-family-discovery/contracts/module-capabilities.md`).
 *
 * A module says, in its own manifest, that it is a member of a capability:
 * `capabilities: [CAPABILITY_KEYS.PIM_CONNECTOR]`. The capability's **owner**
 * says, in its own manifest, that the capability is mutually exclusive and mints
 * the refusal code. Neither side names the other's package, on the same terms an
 * error code and a Page Builder block name are declared (R1.3).
 *
 * Three arrays are what this replaces — `PIM_CONNECTOR_MODULES`,
 * `INVOICE_LEDGER_MODULES` and `ERP_CONNECTOR_MODULES` — each of which is a
 * hand-written copy of a fact the manifests already carry, and each of which a
 * connector installed from npm or a per-deployment overlay module cannot get
 * into without editing a file it does not own.
 */

/**
 * The shape of a capability key: kebab-case, like a Page Builder block category
 * key and deliberately unlike a module id, which is `snake_case` (`moduleIdRe`).
 * The two spellings differ so that a key and an id cannot be confused for one
 * another in a manifest, a log line or a test fixture.
 */
export const capabilityKeyRe = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * The keys minted in this repository.
 *
 * **A capability key is a string, not an enum** (R1.2). A capability owned by a
 * package this repository does not contain is spelled by its owner and needs no
 * entry here — which is the whole point of the field, and the reason nothing in
 * the platform validates a key against this object. These three exist so that
 * the modules in this tree spell theirs once.
 */
export const CAPABILITY_KEYS = {
  PIM_CONNECTOR: 'pim-connector',
  ERP_CONNECTOR: 'erp-connector',
  INVOICE_LEDGER_VENDOR: 'invoice-ledger-vendor',
} as const;

/** One of the keys this repository mints. A member outside it declares a plain string. */
export type CapabilityKey = (typeof CAPABILITY_KEYS)[keyof typeof CAPABILITY_KEYS];
