import type { EntityManager } from '@mikro-orm/postgresql';
import { CommandBus } from '@endora-commerce/platform/commands';
import { AuditLogService } from '@endora-commerce/platform/composition';
import { activeSchemaExtensionContext } from '@endora-commerce/platform/db';
import { EventBus } from '@endora-commerce/platform/events';
import {
  attachEscapeHatchAuditWriter,
  attachOperatorDiagnostics,
  runSchemaExtensionsCommand,
} from '@endora-commerce/platform/lifecycle';
import type { MikroORM } from '@mikro-orm/postgresql';
import { closeOrm, initOrm } from '../../db/index.js';
import { configuredMigrations } from '../../db/configured-migrations.js';
import { enterSystemScope } from '../../kernel/scope.js';

/**
 * `pnpm --filter backend run module:schema-extensions list [--module <id>] [--json]`
 * `pnpm --filter backend run module:schema-extensions drop <moduleId> [--key <key>] [--confirm]`
 * `pnpm --filter backend run module:schema-extensions audit-packages [--json]`
 *
 * The **wiring**, and nothing else (`specs/178-extensible-columns/` FR-081):
 * the grammar, the refusals and the audited drop Command are
 * `@endora-commerce/platform/lifecycle`'s. It opens this instance's ORM — whose
 * configuration discovered every installed package's declarations, which is the
 * set `drop` refuses to touch — and composes nothing (D-157.2).
 */

let auditEm: (() => EntityManager) | undefined;
const escapeHatchAudit = attachEscapeHatchAuditWriter({ em: () => auditEm?.() });

// Issue #819 — stdout is this command's answer; the platform's own lines go to stderr.
attachOperatorDiagnostics((line) => void process.stderr.write(line));

async function main(): Promise<number> {
  let orm: MikroORM | undefined;
  const open = async (): Promise<MikroORM> => {
    orm ??= (await initOrm()) as MikroORM;
    auditEm = (): EntityManager => orm!.em.fork() as EntityManager;
    return orm;
  };
  try {
    return await runSchemaExtensionsCommand(process.argv.slice(2), {
      orm: open,
      declarations: () => activeSchemaExtensionContext().declarations,
      // FR-073 — the installed packages this instance's configuration discovered,
      // as they arrived (the guard wraps them only inside the merged order).
      packages: async () => (await configuredMigrations()).packages,
      commandBus: async () => {
        const opened = await open();
        return new CommandBus(opened, new AuditLogService(() => opened.em.fork()), new EventBus());
      },
      out: (line) => void process.stdout.write(line),
      err: (line) => void process.stderr.write(line),
    });
  } finally {
    await escapeHatchAudit.detach();
    if (orm) await closeOrm();
  }
}

void enterSystemScope('cli: module schema-extensions', main, { entryPoint: 'cli' }).then((code) =>
  process.exit(code),
);
