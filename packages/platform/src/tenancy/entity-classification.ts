import { MetadataStorage } from '@mikro-orm/core';

import { tenantClassifications, type ClassificationMeta } from './org-scoped.decorator.js';

/**
 * No process boots with an entity that carries no tenancy classification, or
 * more than one (`specs/190-overlay-full-modules/` FR-020 – FR-021, #1849,
 * contract `entity-classification-refusal.md`).
 *
 * Principle XI is non-negotiable, and until this refusal it was enforced only by
 * static checks that look for `@Entity(` in source text
 * (`check-entity-tenant-classification.ts` and its CLI rule). They stay — they
 * fail earlier, in review — but they cannot read what they cannot see: a
 * compiled package, where the decorator is a `__decorate([...])` call, and every
 * instance, which no check of this repository runs over. An entity with no
 * classification has no tenant filter, so the boot it would otherwise get is an
 * untenanted read; there is deliberately no degraded mode.
 *
 * It is judged over the **configured** list, not over everything that was ever
 * decorated: a class decorated in a test or left unregistered is not one this
 * process maps. Identity, not name: two classes of one name in two modules are
 * two subjects.
 */

/** One class the ORM will be handed, and who contributed it. */
export interface ContributedEntity {
  readonly cls: unknown;
  /** `core`, an npm package name, or an overlay's source label. */
  readonly contributor: string;
}

export interface ClassificationFinding {
  readonly className: string;
  readonly contributor: string;
  readonly kind: 'unclassified' | 'multiply-classified';
}

export class UnclassifiedEntityError extends Error {
  readonly findings: readonly ClassificationFinding[];

  constructor(findings: readonly ClassificationFinding[], counts: ReadonlyMap<string, number>) {
    const lines = findings.map((finding) =>
      finding.kind === 'unclassified'
        ? `  - ${finding.className} (${finding.contributor})`
        : `  - ${finding.className} (${finding.contributor}) — classified ${String(
            counts.get(`${finding.contributor}\u0000${finding.className}`) ?? 2,
          )} times`,
    );
    const noun = findings.length === 1 ? 'entity class carries' : 'entity classes carry';
    super(
      `[tenancy] ${String(findings.length)} ${noun} no tenancy classification, or more than one ` +
        `(Principle XI):\n${lines.join('\n')}\n` +
        'Each persisted entity carries exactly one of @OrgScoped, @CustomerScoped, ' +
        '@TransitivelyScoped, @RuleScoped or @GlobalEntity. Nothing was opened.',
    );
    this.name = 'UnclassifiedEntityError';
    this.findings = findings;
  }
}

interface DecoratorMetadata {
  readonly embeddable?: boolean;
  readonly abstract?: boolean;
}

/**
 * Whether MikroORM records `cls` as a persisted entity (FR-021): an embeddable
 * or an abstract base is not one, as the decorator's own metadata says — never
 * by a name list. A legacy decorator keeps that metadata on the class itself
 * under `META_SYMBOL` (MikroORM 7, #1866), an own property, so a subclass that
 * is not decorated itself does not inherit its parent's answer.
 */
function isPersistedEntity(cls: unknown): boolean {
  if (typeof cls !== 'function') return false;
  const meta = Object.hasOwn(cls, MetadataStorage.META_SYMBOL)
    ? (cls as unknown as Record<symbol, DecoratorMetadata | undefined>)[MetadataStorage.META_SYMBOL]
    : undefined;
  return meta?.embeddable !== true && meta?.abstract !== true;
}

/**
 * Refuse, listing every finding at once, when any persisted entity in
 * `entities` has no tenancy classification or more than one.
 */
export function assertEntitiesClassified(
  entities: readonly ContributedEntity[],
  classifications: readonly ClassificationMeta[] = tenantClassifications(),
): void {
  const findings: ClassificationFinding[] = [];
  const counts = new Map<string, number>();
  const seen = new Set<unknown>();
  for (const { cls, contributor } of entities) {
    if (seen.has(cls) || !isPersistedEntity(cls)) continue;
    seen.add(cls);
    const count = classifications.filter((meta) => (meta.target as unknown) === cls).length;
    if (count === 1) continue;
    const className = (cls as { name: string }).name;
    counts.set(`${contributor}\u0000${className}`, count);
    findings.push({
      className,
      contributor,
      kind: count === 0 ? 'unclassified' : 'multiply-classified',
    });
  }
  if (findings.length > 0) throw new UnclassifiedEntityError(findings, counts);
}
