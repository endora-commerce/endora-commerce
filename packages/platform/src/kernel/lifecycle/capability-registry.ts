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
  if (contested.length > 0) throw new ContestedCapabilityError(contested);

  return { declarations, exclusive };
}
