import type { ModuleManifest } from '@endora-commerce/contracts';

/**
 * The derived capability registry — which modules declare membership of which
 * named family, and which module owns each family it is mutually exclusive in
 * (feature 132, `specs/132-connector-family-discovery/contracts/module-capabilities.md`,
 * `data-model.md` §2).
 *
 * ## What it replaces
 *
 * Three hand-maintained arrays in `@endora-commerce/contracts` —
 * `PIM_CONNECTOR_MODULES`, `INVOICE_LEDGER_MODULES`, `ERP_CONNECTOR_MODULES` —
 * each of which is a copy of a fact the manifests already carry. The copy is
 * D-100's shape and it had already gone wrong in both directions: two of the four
 * shipped PIM connectors were not on the list, so exclusivity covered 2 of the 12
 * ordered pairs; and an **overlay** module had to be written into a core contracts
 * file to join its family, which is Principle XV failing in the only way it can
 * fail quietly — the overlay was written correctly and the core edit was made
 * anyway, because there was no other way in.
 *
 * The rule this is an instance of is the one `requiredModulesFrom`'s header
 * states: derive it on every composition, so a member who joins or withdraws
 * changes the answer in the same run, with no list to edit.
 *
 * ## Why it is a parameter and not an import
 *
 * **The platform may not import a module** (D-52/D-53). So the manifests arrive
 * as an argument, exactly as they do for `activationDeclarationsFrom` and
 * `requiredModulesFrom`, and the population is whatever the composition root
 * resolved: core modules, this deployment's overlay modules, and every installed
 * Endora module package. That is the whole reason the field exists — a connector
 * living outside this repository can declare membership, and no file in this
 * repository names it.
 *
 * ## Why it is plain data
 *
 * Same reason `ModuleActivationDeclaration` is: it is installed into the registry
 * cache, which is on the hot path, and that cache must never import the manifest
 * graph.
 */

/** One module's capability declarations, distilled from its manifest. */
export interface ModuleCapabilityDeclaration {
  readonly moduleId: string;
  readonly capabilities: readonly string[];
}

/** One exclusive capability, and who owns it. */
export interface ExclusiveCapabilityDeclaration {
  readonly key: string;
  readonly ownerModuleId: string;
  readonly errorCode: string;
}

export interface CapabilityRegistry {
  readonly declarations: readonly ModuleCapabilityDeclaration[];
  readonly exclusive: readonly ExclusiveCapabilityDeclaration[];
}

/** One key claimed by more than one installed module. */
export interface ContestedCapabilityFinding {
  readonly key: string;
  readonly ownerModuleIds: readonly string[];
}

/**
 * Two modules claim to own one capability (R3.4).
 *
 * A distinct error type, per D-101's closing rule about the refusals that share a
 * manifest declaration and share nothing else: this refuses a **deployment that
 * was assembled wrong**, from the manifests, before the first module registers —
 * not a transition an operator asked for, and not something to answer with an
 * HTTP envelope.
 *
 * It fails closed rather than picking a claimant, because a contested capability
 * routes to neither: the refusal code, the lock row and the admin page all belong
 * to "the owner", and with two of them every one of those three answers is
 * arbitrary. `check:error-translations` reaches the same verdict about a code with
 * two declarers, and for the same reason.
 */
export class ContestedCapabilityError extends Error {
  readonly findings: readonly ContestedCapabilityFinding[];

  constructor(findings: readonly ContestedCapabilityFinding[]) {
    super(refusalMessage(findings));
    this.name = 'ContestedCapabilityError';
    this.findings = findings;
  }
}

function refusalMessage(findings: readonly ContestedCapabilityFinding[]): string {
  const lines: string[] = [
    'This deployment will not start: a capability is claimed by more than one owner.',
    '',
  ];
  for (const finding of findings) {
    lines.push(
      `  ${finding.key} — claimed by ${finding.ownerModuleIds.join(', ')}`,
      '      Each of them declares it in `exclusiveCapabilities`, so the refusal code, the',
      '      activation lock and the claim-holder page would all have two owners and the',
      '      exclusion would route to neither.',
      '',
    );
  }
  lines.push(
    'Exactly one installed module may own a capability. A module that merely *belongs* to the',
    'family declares it in `capabilities` instead; ownership is the declaration that the family',
    'is mutually exclusive and mints the code an operator meets.',
  );
  return lines.join('\n');
}

/** One member of an exclusive key that ships activated. */
export interface DefaultActivatedMemberFinding {
  readonly moduleId: string;
  readonly key: string;
  /** The activation control whose declared default is the problem. */
  readonly settingCode: string;
}

/**
 * A member of an **exclusive** capability declares `activation.default: true`
 * (R3.6, spec FR-016).
 *
 * ## Why this is a refusal and not a runtime tolerance
 *
 * `resolveActivation` returns `Map<string, boolean>` and carries **no provenance**:
 * nothing downstream can tell "the operator wrote this row" from "no row exists and
 * the manifest said `true`". So a mutual exclusion resolved on the activation axis
 * cannot ask the question it needs to ask, and a default-activated member holds a
 * claim nobody made — which is what an operator meets as a refusal naming a
 * connector they never configured.
 *
 * The tempting repair is to add provenance and have the exclusion require an
 * **explicit** choice. It is unsafe, and `research.md` D6 records why: member `A`
 * default-activated and member `B` explicitly activated would then **both** be
 * active, because the test that was supposed to refuse `B` now ignores `A`. A mutual
 * exclusion may not fail open. Refusing the manifest makes the state unreachable
 * rather than tolerated, which is the difference between a guard and a repair.
 *
 * ## Why it is weaker-looking than the defect it prevents, and is not
 *
 * The exclusion is a `pre` interceptor on the activation route, so it guards the
 * **transition** and not the **existing state**: two default-activated members are
 * both present from the first boot and no transition ever happens to be refused.
 * Nothing surfaces it. That is not a hypothetical — it was measured on a freshly
 * migrated database, three connectors deep, before this refusal existed.
 *
 * ## Why not `defineModuleManifest`
 *
 * Same reason {@link ContestedCapabilityError} is not there: that function sees one
 * manifest and cannot see whether the key is **exclusive**, which is the owner's
 * declaration. Both facts are in hand only here. `check:port-dependencies` carries
 * the same assertion as an earlier instrument for this repository's own modules
 * (R3.7); the two layers cover what the other cannot — the check sees a member merged
 * here before anybody boots, and this sees a connector installed from npm, which no
 * check in this repository walks.
 */
export class DefaultActivatedMemberError extends Error {
  readonly findings: readonly DefaultActivatedMemberFinding[];

  constructor(findings: readonly DefaultActivatedMemberFinding[]) {
    super(defaultActivatedMessage(findings));
    this.name = 'DefaultActivatedMemberError';
    this.findings = findings;
  }
}

function defaultActivatedMessage(
  findings: readonly DefaultActivatedMemberFinding[],
): string {
  const lines: string[] = [
    'This deployment will not start: a module ships activated into a capability that ' +
      'permits one active member.',
    '',
  ];
  for (const finding of findings) {
    lines.push(
      `  ${finding.moduleId} — declares \`capabilities: ['${finding.key}']\` and ` +
        `\`activation.default: true\``,
      `      remedy: set \`default: false\` on \`${finding.settingCode}\` in ` +
        `${finding.moduleId}'s manifest.`,
      '',
    );
  }
  lines.push(
    'An exclusion resolved on the activation axis cannot tell an operator\'s recorded choice',
    'from a manifest default — the resolver returns booleans and carries no provenance — so a',
    'member that ships activated holds a claim nobody made. Two such members are both active',
    'from the first boot, and the exclusion guards the *transition* rather than the existing',
    'state, so nothing ever refuses it and nothing reports it.',
    '',
    'Shipping off is not a smaller default: it is the only one an operator can be asked to',
    'choose from. A member the deployment wants running is switched on once, on',
    '/platform/modules, and that choice is recorded and survives every upgrade.',
  );
  return lines.join('\n');
}

/**
 * Distil the capability registry from a manifest list.
 *
 * A module that declares nothing is omitted, and so is one whose `capabilities`
 * is present but empty: an empty array says nothing a missing field does not, and
 * carrying it would put a member with no family into every family read.
 *
 * **A member of a key that no installed module owns is not an error** (R3.5). The
 * capability is simply not exclusive in that deployment and the member works.
 * Refusing would turn a shared layer into an undeclared hard dependency, which is
 * what `dependencies` is for and which the member already declares if it genuinely
 * needs it.
 *
 * Order is manifest order, deliberately: every message derived from this reads in
 * the order the deployment composes, which is the order the author is looking at.
 */
export function capabilityRegistryFrom(
  manifests: readonly ModuleManifest[],
): CapabilityRegistry {
  const declarations: ModuleCapabilityDeclaration[] = [];
  const exclusive: ExclusiveCapabilityDeclaration[] = [];
  const claimants = new Map<string, string[]>();

  for (const manifest of manifests) {
    const capabilities = manifest.capabilities ?? [];
    if (capabilities.length > 0) {
      declarations.push({ moduleId: manifest.id, capabilities: [...capabilities] });
    }
    for (const entry of manifest.exclusiveCapabilities ?? []) {
      exclusive.push({
        key: entry.key,
        ownerModuleId: manifest.id,
        errorCode: entry.errorCode,
      });
      const claimed = claimants.get(entry.key) ?? [];
      claimed.push(manifest.id);
      claimants.set(entry.key, claimed);
    }
  }

  const contested: ContestedCapabilityFinding[] = [];
  for (const [key, ownerModuleIds] of claimants) {
    if (ownerModuleIds.length > 1) contested.push({ key, ownerModuleIds });
  }
  // Ordering is deliberate: whether a member's default is illegal depends on the key
  // being exclusive, and a key with two claimants is exclusive on nobody's authority.
  // The mis-assembly has to be read first.
  if (contested.length > 0) throw new ContestedCapabilityError(contested);

  // R3.6 / FR-016 — reported per (module, key) pair, so the message says which of a
  // member's keys is the one that cannot tolerate the default. Only an **exclusive**
  // key counts: a key no installed module owns is not exclusive in this deployment, so
  // there is no claim for a default to pre-empt (R3.5).
  const exclusiveKeys = new Set(exclusive.map((entry) => entry.key));
  const defaultActivated: DefaultActivatedMemberFinding[] = [];
  for (const manifest of manifests) {
    const activation = manifest.activation;
    // A `nonDeactivatable` module declares no control and is not resolved on this axis
    // — every family owner in this tree is one. A member with no `activation` at all is
    // already refused by `defineModuleManifest` (R4.1) and cannot reach here.
    if (activation === undefined || 'nonDeactivatable' in activation) continue;
    if (activation.default !== true) continue;
    for (const key of manifest.capabilities ?? []) {
      if (!exclusiveKeys.has(key)) continue;
      defaultActivated.push({
        moduleId: manifest.id,
        key,
        settingCode: activation.settingCode,
      });
    }
  }
  if (defaultActivated.length > 0) throw new DefaultActivatedMemberError(defaultActivated);

  return { declarations, exclusive };
}
