/**
 * `module:schema-extensions` in a tree that ships no generated index — the
 * instance's sixth operator command (issue #1036).
 *
 * `specs/178-extensible-columns/` FR-081 put the grammar, the refusals and the
 * audited `schema_extension.drop` Command in {@link runSchemaExtensionsCommand}
 * and gave it one entry point, this repository's
 * `backend/src/lifecycle/scripts/schema-extensions.ts`. An instance — the tree
 * that actually holds declared extension columns — had none, so it could not
 * list its ledger, could not drop the columns an uninstalled package left
 * orphaned (OD-29: there is no other sanctioned way) and could not run the
 * pre-upgrade `audit-packages`. This builds the same runtime that script
 * builds, from the one value an instance genuinely owns: its own
 * `mikro-orm.config.js`. The rendered file is four lines (R1.4).
 *
 * ## Why it is not a sixth body over `runInstanceOperatorCommand`
 *
 * The five `module:*` bodies take an `OperatorRuntime`, whose
 * `resources()` opens PostgreSQL **and Redis** and whose `entries` resolves the
 * manifest set before anything runs. This command needs neither: it reads the
 * ledger, runs one Command over PostgreSQL and reads the installed packages'
 * migrations. Built over that runtime it would open a Redis connection it never
 * uses — on the operator's machine, where Redis may well be down — and refuse
 * over a manifest-set collision that has nothing to do with the ledger. The
 * shape it shares with the five is the one that matters: no container, nothing
 * composed (D-157.2), the system scope around the body, the escape-hatch audit
 * writer attached before it, diagnostics on stderr (#819), the ORM opened on
 * first use (R2.6) and closed before the exit.
 *
 * ## Where "still declared" comes from
 *
 * `drop` refuses an element an installed package still declares. In an
 * instance the declarations are whatever the instance's ORM configuration
 * discovered and recorded while it was built — the same set its `migrate`
 * reconciled the ledger against. They are read only after the ORM is open, and
 * a configuration that recorded nothing is refused rather than read as
 * "nothing is declared", which would let `drop` remove a live extension's
 * columns.
 */
import { MikroORM, type Options } from '@mikro-orm/postgresql';

import { CommandBus } from '../../commands/command-bus.js';
import { discoverConfiguredMigrations } from '../../db/configured-migrations.js';
import { EventBus } from '../../events/bus.js';
import { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import { attachEscapeHatchAuditWriter } from '../../kernel/audit/escape-hatch-audit-writer.js';
import {
  activeSchemaExtensionContext,
  schemaExtensionContextRecorded,
} from '../../kernel/schema-extensions/registry.js';
import { enterSystemScope } from '../../kernel/scope.js';
import { attachOperatorDiagnostics } from './operator-diagnostics.js';
import { runSchemaExtensionsCommand, type SchemaExtensionsRuntime } from './schema-extensions.js';

/** What an instance supplies: its ORM configuration, and the ambient environment. */
export interface InstanceSchemaExtensionsOptions {
  /**
   * The instance's own `mikro-orm.config.js` default export. A function, for
   * the reason `OperatorRuntime`'s instance builder takes one: calling it
   * reads `DATABASE_URL` and discovers the installed packages, and an
   * invocation that answers out of argv must not.
   */
  readonly ormConfig: () => Promise<Options>;
  readonly env?: NodeJS.ProcessEnv;
  readonly argv?: readonly string[];
  readonly out?: (line: string) => void;
  readonly err?: (line: string) => void;
}

/**
 * Build the {@link SchemaExtensionsRuntime} an instance runs the command over,
 * and the `dispose` that closes only what was opened.
 */
export function instanceSchemaExtensionsRuntime(options: InstanceSchemaExtensionsOptions): {
  runtime: SchemaExtensionsRuntime;
  dispose: () => Promise<void>;
} {
  const env = options.env ?? process.env;
  const out = options.out ?? ((line: string) => void process.stdout.write(line));
  const err = options.err ?? ((line: string) => void process.stderr.write(line));
  // Issue #819 — stdout is this command's answer (`--json` included).
  const detachDiagnostics = attachOperatorDiagnostics(err);
  let opened: MikroORM | undefined;
  // Cross-organisation access is audited in the database (owner decision of
  // 2026-10-03), through the ORM this command opens — and only if it opens one.
  const escapeHatchAudit = attachEscapeHatchAuditWriter({ em: () => opened?.em.fork() });
  const orm = async (): Promise<MikroORM> => {
    opened ??= await MikroORM.init(await options.ormConfig());
    return opened;
  };
  return {
    runtime: {
      orm,
      declarations: () => {
        if (!schemaExtensionContextRecorded()) {
          throw new Error(
            'the ORM configuration recorded no schema-extension declarations, so what is still ' +
              'declared is unknown. Build it with mikroOrmConfigFrom, as the scaffolded ' +
              'backend/src/mikro-orm.config.ts does.',
          );
        }
        return activeSchemaExtensionContext().declarations;
      },
      // FR-073 — the installed packages, as the instance's own configuration
      // discovers them (an instance's committed half is empty).
      packages: async () =>
        (await discoverConfiguredMigrations({ coreEntries: [], manifests: [] }, env)).packages,
      commandBus: async () => {
        const opening = await orm();
        return new CommandBus(opening, new AuditLogService(() => opening.em.fork()), new EventBus());
      },
      out,
      err,
    },
    dispose: async (): Promise<void> => {
      try {
        await escapeHatchAudit.detach();
        if (opened) await opened.close(true);
      } finally {
        detachDiagnostics();
      }
    },
  };
}

/** Build the runtime, run the command inside a system scope, close, exit. */
export async function runInstanceSchemaExtensionsCommand(
  options: InstanceSchemaExtensionsOptions,
): Promise<never> {
  const { runtime, dispose } = instanceSchemaExtensionsRuntime(options);
  const argv = options.argv ?? process.argv.slice(2);
  let code: number;
  try {
    code = await enterSystemScope(
      'cli: module schema-extensions',
      () => runSchemaExtensionsCommand(argv, runtime),
      { entryPoint: 'cli' },
    );
  } finally {
    await dispose();
  }
  process.exit(code);
}
