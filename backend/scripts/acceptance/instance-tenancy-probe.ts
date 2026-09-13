/**
 * A9's probe — the tenant guard, read inside the instance this run created
 * (`specs/110-instance-repository/contracts/instance-repository.md` R6.3).
 *
 * It is a separate process for `instance-probe.ts`' reason one criterion over:
 * everything it asks it asks through the **instance's own** packages, resolved
 * from the instance's `node_modules` and never from this checkout, so a guard
 * this repository composes correctly and that package does not is a red rather
 * than a silence. It prints exactly one machine-readable line
 * (`ACCEPTANCE_JSON {...}`) on stdout.
 *
 * ## What it can ask, and what it cannot
 *
 * A tenant context is derived server-side from the authenticated actor and
 * established by the host, so an instance's **published** surface offers a
 * process exactly two of the four modes: none at all, and `withSystemScope`.
 * `withOrgScope` exists in the platform's `tenancy/escape-hatch.ts` and
 * `./tenancy` does not export it, and reaching past the exports map to get at
 * it would make this verdict depend on an internal path that may move — a red
 * about the criterion wearing the product's colours.
 *
 * So the cross-tenant read this refuses is **the unscoped one**, and the second
 * leg is what stops that being a vacuous claim: the identical read, run under
 * `withSystemScope`, comes back with rows belonging to **two different
 * organizations**. The query the guard refused is therefore demonstrably one
 * that would have crossed a tenant boundary, which is A9's own sentence. The
 * third leg narrows it with the published derived-scope helper
 * (`orgConstraintFor`), so the "only this tenant's rows" half is measured too —
 * against the helper a module writes, rather than against the ambient filter no
 * client process can establish.
 *
 * ## Nothing here names an entity
 *
 * The subject is chosen from the instance's **own ORM metadata**: the entities
 * carrying the `org` global filter, smallest required-property set first, and
 * the first one this process can actually write two rows of. A name written
 * down here would be right until the default module set moved (D-100), and the
 * report says which entity answered.
 */

/* eslint-disable no-console -- this file's stdout is its interface. */

import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Thrown for "the probe could not run", never for "the guard answered wrong". */
class Inconclusive extends Error {}

function instanceRoot(): string {
  const root = process.env['ACCEPTANCE_INSTANCE_ROOT'];
  if (!root) throw new Inconclusive('ACCEPTANCE_INSTANCE_ROOT is not set');
  return root;
}

/**
 * Resolve a package the way the instance's **backend member** would — a
 * `createRequire` rooted there, never at this file, and the member rather than
 * the workspace root.
 *
 * A resolution rooted here would answer out of this checkout, and the whole
 * question is what the *installed* platform does. The member rather than the
 * root because pnpm installs a package where it is **declared**, and the ORM is
 * the backend member's: rooting at the workspace root resolved a
 * `@mikro-orm/postgresql` of a different patch from the `@mikro-orm/migrations`
 * the member's own ORM configuration loads, and MikroORM refuses the pair.
 * `shippedBy()` in `instance.ts` learned the same lesson about the admin shell.
 */
async function importInstalled(specifier: string): Promise<Record<string, unknown>> {
  const anchors = [join(instanceRoot(), 'backend', 'noop.js'), join(instanceRoot(), 'noop.js')];
  const failures: string[] = [];
  for (const anchor of anchors) {
    try {
      const resolved = createRequire(anchor).resolve(specifier);
      return (await import(pathToFileURL(resolved).href)) as Record<string, unknown>;
    } catch (error) {
      failures.push(`${anchor}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Inconclusive(`${specifier} does not resolve in the instance — ${failures.join(' | ')}`);
}

/** A connection failure is the probe's problem; anything else is the platform's. */
function classifyError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo|Connection terminated|password authentication failed/i.test(
      message,
    )
  ) {
    throw new Inconclusive(`a service the probe needs was not reachable: ${message}`);
  }
  throw error instanceof Error ? error : new Error(message);
}

/** The shape `evaluateA9` judges. Kept in step with `instance-assertions.ts`. */
interface TenancyObservation {
  readonly entity: string | null;
  readonly organizations: readonly string[];
  readonly unscopedRead: 'refused' | 'returned' | null;
  readonly refusalName: string | null;
  readonly systemScopeOrganizations: readonly string[];
  readonly narrowedOrganizations: readonly string[] | null;
  readonly candidatesTried: readonly string[];
}

/** Minimal MikroORM shapes, so this file needs no type-only import of the ORM. */
interface EntityProperty {
  readonly name: string;
  readonly type?: string;
  readonly primary?: boolean;
  readonly nullable?: boolean;
  readonly persist?: boolean;
  readonly embedded?: unknown;
  readonly default?: unknown;
  readonly defaultRaw?: unknown;
  readonly onCreate?: unknown;
  readonly autoincrement?: boolean;
  readonly kind?: string;
}
interface EntityMetadata {
  readonly className: string;
  readonly tableName: string;
  readonly abstract?: boolean;
  readonly filters?: Record<string, unknown>;
  readonly properties: Record<string, EntityProperty>;
}

/** The tenant key every `@OrgScoped` entity carries, by definition. */
const ORG_KEY = 'organizationId';
/** The global filter the `@OrgScoped` decorator attaches. */
const ORG_FILTER = 'org';

/**
 * The properties a row of this entity must carry that nothing supplies for it —
 * a primary key with no default included, because `em.create` will not invent
 * one either.
 */
function requiredProperties(meta: EntityMetadata): readonly EntityProperty[] {
  const required: EntityProperty[] = [];
  for (const property of Object.values(meta.properties)) {
    if (property.persist === false || property.embedded !== undefined) continue;
    if (property.name === ORG_KEY) continue;
    if (property.nullable === true) continue;
    if (property.default !== undefined || property.defaultRaw !== undefined) continue;
    if (property.onCreate !== undefined) continue;
    if (property.primary === true && property.autoincrement === true) continue;
    required.push(property);
  }
  return required;
}

/**
 * A value of the property's own declared type, or `undefined` for a type this
 * probe will not invent one for — which drops the whole candidate rather than
 * writing a row that means something.
 */
function valueFor(property: EntityProperty): unknown {
  const type = (property.type ?? '').toLowerCase();
  if (property.primary === true && /uuid/.test(type)) return randomUUID();
  if (/uuid/.test(type)) return randomUUID();
  if (/decimal|numeric/.test(type)) return '0';
  if (/int|float|double|number/.test(type)) return 0;
  if (/bool/.test(type)) return false;
  if (/date|time/.test(type)) return new Date();
  if (/json|object/.test(type)) return {};
  if (/string|text|varchar|char/.test(type)) {
    return property.name.toLowerCase().includes('email')
      ? `a9-${randomUUID()}@instance.acceptance.invalid`
      : `a9-${randomUUID().slice(0, 8)}`;
  }
  return undefined;
}

/** `{ prop: value }` for every required property, or `null` if one has no value. */
function seedFor(meta: EntityMetadata): Record<string, unknown> | null {
  const seed: Record<string, unknown> = {};
  for (const property of requiredProperties(meta)) {
    const value = valueFor(property);
    if (value === undefined) return null;
    seed[property.name] = value;
  }
  return seed;
}

async function main(): Promise<void> {
  const { MikroORM } = (await importInstalled('@mikro-orm/postgresql')) as unknown as {
    MikroORM: {
      init: (options: unknown) => Promise<{
        em: { fork: () => never };
        getMetadata: () => { getAll: () => Record<string, EntityMetadata> };
        close: (force?: boolean) => Promise<void>;
      }>;
    };
  };
  const tenancy = (await importInstalled('@endora-commerce/platform/tenancy')) as unknown as {
    withSystemScope: <T>(reason: string, fn: () => Promise<T>) => Promise<T>;
    orgConstraintFor: (ctx: unknown) => { kind: string; organizationId?: string | null };
  };

  const configModule = (await import(
    pathToFileURL(join(instanceRoot(), 'backend', 'dist', 'mikro-orm.config.js')).href
  ).catch((error: unknown) => {
    throw new Inconclusive(
      `the instance's own ORM configuration did not load, so there is no schema to read: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  })) as { default: () => Promise<unknown> };

  let orm: Awaited<ReturnType<(typeof MikroORM)['init']>>;
  try {
    orm = await MikroORM.init(await configModule.default());
  } catch (error) {
    classifyError(error);
  }

  try {
    const metadata = Object.values(orm.getMetadata().getAll()).filter(
      (meta) => meta.abstract !== true,
    );
    const organizations = metadata.find((meta) => meta.tableName === 'organizations');
    if (organizations === undefined) {
      throw new Inconclusive(
        'no entity in this instance maps the `organizations` table, so there is no tenant to ' +
          'read across (Principle XI: the Organization is the one tenant concept)',
      );
    }
    const candidates = metadata
      .filter((meta) => Object.keys(meta.filters ?? {}).includes(ORG_FILTER))
      .filter((meta) => meta.properties[ORG_KEY] !== undefined)
      .sort(
        (left, right) =>
          requiredProperties(left).length - requiredProperties(right).length ||
          left.className.localeCompare(right.className),
      );
    if (candidates.length === 0) {
      throw new Inconclusive(
        `no entity this instance registered carries the '${ORG_FILTER}' global filter, so the ` +
          'guard has nothing to be active on and a refusal would say nothing',
      );
    }

    // The two tenants. Written under the sanctioned widening, which is the only
    // way any process crosses organizations (FR-005/FR-013).
    const organizationIds: string[] = [];
    await tenancy
      .withSystemScope('acceptance: A9 writes the two tenants it reads across', async () => {
        const em = orm.em.fork() as unknown as {
          create: (entity: unknown, data: Record<string, unknown>) => unknown;
          flush: () => Promise<void>;
        };
        for (let index = 0; index < 2; index += 1) {
          const seed = seedFor(organizations);
          if (seed === null) {
            throw new Inconclusive(
              `${organizations.className} requires a property this probe will not invent a ` +
                'value for, so the two tenants cannot be created',
            );
          }
          const created = em.create(organizations.className, seed) as { id?: string };
          await em.flush();
          if (typeof created.id !== 'string') {
            throw new Inconclusive(
              `${organizations.className} came back with no string id, so there is no tenant ` +
                'key to scope a read to',
            );
          }
          organizationIds.push(created.id);
        }
      })
      .catch((error: unknown) => {
        if (error instanceof Inconclusive) throw error;
        throw new Inconclusive(
          `the two tenants could not be written: ${error instanceof Error ? error.message : String(error)}`,
        );
      });

    // The subject: the first org-filtered entity this process can write a row
    // of per tenant. Tried in order rather than named, so a module set that
    // moves moves the subject with it.
    let subject: EntityMetadata | null = null;
    const tried: string[] = [];
    for (const candidate of candidates) {
      const seedA = seedFor(candidate);
      const seedB = seedFor(candidate);
      if (seedA === null || seedB === null) {
        tried.push(`${candidate.className}: a required property has no value this probe invents`);
        continue;
      }
      try {
        await tenancy.withSystemScope('acceptance: A9 seeds one row per tenant', async () => {
          const em = orm.em.fork() as unknown as {
            create: (entity: unknown, data: Record<string, unknown>) => unknown;
            flush: () => Promise<void>;
          };
          em.create(candidate.className, { ...seedA, [ORG_KEY]: organizationIds[0] });
          em.create(candidate.className, { ...seedB, [ORG_KEY]: organizationIds[1] });
          await em.flush();
        });
        subject = candidate;
        break;
      } catch (error) {
        tried.push(
          `${candidate.className}: ${(error instanceof Error ? error.message : String(error)).slice(0, 160)}`,
        );
      }
    }
    if (subject === null) {
      throw new Inconclusive(
        `none of the ${String(candidates.length)} org-filtered entities took a row per tenant, ` +
          `so there is nothing to read across: ${tried.slice(0, 4).join(' | ')}`,
      );
    }

    // Leg 1 — the cross-tenant read, with no context at all. The guard is
    // fail-closed by construction, so this must raise rather than answer.
    let unscopedRead: 'refused' | 'returned' = 'returned';
    let refusalName: string | null = null;
    try {
      const em = orm.em.fork() as unknown as {
        find: (entity: unknown, where: Record<string, unknown>) => Promise<unknown[]>;
      };
      await em.find(subject.className, {});
    } catch (error) {
      unscopedRead = 'refused';
      refusalName = error instanceof Error ? error.name : String(error);
    }

    // Leg 2 — the same read, widened. It is what stops leg 1 being vacuous: the
    // query the guard refused comes back here holding both tenants' rows.
    const rowsOf = (rows: readonly unknown[]): string[] => [
      ...new Set(
        rows
          .map((row) => (row as Record<string, unknown>)[ORG_KEY])
          .filter((value): value is string => typeof value === 'string'),
      ),
    ].sort();
    const systemScopeOrganizations = await tenancy.withSystemScope(
      'acceptance: A9 reads the same query across tenants',
      async () => {
        const em = orm.em.fork() as unknown as {
          find: (entity: unknown, where: Record<string, unknown>) => Promise<unknown[]>;
        };
        return rowsOf(await em.find(subject.className, {}));
      },
    );

    // Leg 3 — narrowed to one tenant through the published derived-scope
    // helper, which is the constraint a module applies where the column filter
    // cannot reach.
    const constraint = tenancy.orgConstraintFor({
      mode: 'single-org',
      organizationId: organizationIds[0],
      reason: 'acceptance: A9',
    });
    const narrowedOrganizations =
      constraint.kind === 'single' && typeof constraint.organizationId === 'string'
        ? await tenancy.withSystemScope('acceptance: A9 narrows to one tenant', async () => {
            const em = orm.em.fork() as unknown as {
              find: (entity: unknown, where: Record<string, unknown>) => Promise<unknown[]>;
            };
            return rowsOf(
              await em.find(subject.className, { [ORG_KEY]: constraint.organizationId }),
            );
          })
        : null;

    const observation: TenancyObservation = {
      entity: `${subject.className} (${subject.tableName})`,
      organizations: organizationIds,
      unscopedRead,
      refusalName,
      systemScopeOrganizations,
      narrowedOrganizations,
      candidatesTried: tried,
    };
    console.log(`ACCEPTANCE_JSON ${JSON.stringify({ observation })}`);
  } finally {
    await orm.close(true).catch(() => undefined);
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof Inconclusive) {
    console.log(`ACCEPTANCE_JSON ${JSON.stringify({ inconclusive: error.message })}`);
  } else {
    console.log(
      `ACCEPTANCE_JSON ${JSON.stringify({
        probeError: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      })}`,
    );
  }
}
