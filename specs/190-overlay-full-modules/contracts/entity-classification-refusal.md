# Contract — No process boots with an unclassified entity (FR-020 – FR-022, R-10, #1849)

Waits for #1866 (the metadata-storage API it reads is v7's).

## §1 Where and when

In `configuredEntitiesFrom` (platform `db/configured-entities.ts`), after the merged entity list is
built and beside `assertTransitiveParentsResolve` — before the ORM exists, so before any connection
or query, in every process that configures the ORM: API, worker, `migrate`, `module:*`, the operator
CLI and the test harness.

## §2 Predicate

For every class `C` in the merged list that MikroORM's metadata storage records as an entity (not an
embeddable, not abstract):

- `count(tenantClassifications() where target === C) === 0` → `unclassified`;
- `> 1` → `multiply-classified`.

Identity, not name: two classes of one name in two modules are two subjects. The five decorators are
the ones `tenancy/org-scoped.decorator.ts` registers (`OrgScoped`, `CustomerScoped`, `GlobalEntity`,
`TransitivelyScoped`, `RuleScoped`).

## §3 Refusal

`UnclassifiedEntityError` (platform `tenancy/`), listing every finding at once:

```text
[tenancy] 2 entity classes carry no tenancy classification (Principle XI):
  - LoyaltyAccount (overlay apps/acme/modules/acme_loyalty)
  - XlCursor (@acme/mod-xl)
Each persisted entity carries exactly one of @OrgScoped, @CustomerScoped, @TransitivelyScoped,
@RuleScoped or @GlobalEntity. Nothing was opened.
```

The contributor is known from the merge: core registry → `core`, package → npm name, overlay → source
label.

## §4 Relation to the static checks

The static checks stay (they fail earlier, in review); this refusal is the backstop for what they
cannot read — compiled packages and every instance. `../paid-modules` was scanned on 2026-11-23: every
`@Entity(` file there carries a classification decorator, so the refusal changes no paid module's boot.

## §5 Tests

Unit: an undecorated class in each origin (core list, package fixture, overlay fixture) → refused,
named; a doubly-decorated class → refused; an embeddable → ignored. Integration: the full
composition of this repository boots (no false positive over the ~220 core entities).
