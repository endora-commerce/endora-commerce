import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MikroORM } from '@mikro-orm/postgresql';
import { migrateUpVerified } from '@endora-commerce/platform/db';
import {
  BASE_DATABASE_URL_ENV,
  cloneTemplateForCaller,
  dropRunDatabase,
  TEMPLATE_DATABASE_ENV,
} from '@endora-commerce/test-kit/database';

import mikroOrmConfig from '../../src/db/mikro-orm.config.js';

/**
 * The worked example `mod-acme-erp` installed into a throwaway instance root,
 * over a database of its own (`specs/178-extensible-columns/` T042 – T044,
 * `quickstart.md`).
 *
 * The package is copied into `<root>/node_modules/@acme/mod-acme-erp` — the
 * shape an installed package has — and the process is pointed at it with
 * `ENDORA_INSTANCE_ROOT`, so the backend's **own** ORM configuration discovers
 * it exactly as an instance's would: its declaration, its generated step at the
 * head of its block, its back-fill migration and its projection.
 *
 * The database is a clone of the invocation's migrated template (core schema and
 * platform invariants, so the harness's seed and boot run unchanged), migrated
 * forward here with `migrateUpVerified` — the generated step and the back-fill
 * are the only pending entries. It is never the invocation's shared run
 * database: the extension's columns must not leak into the files beside this
 * one (`test/migrator-driving-tests.ts`' reason).
 *
 * **Call it before anything in the file reads the ORM configuration.** The
 * backend's configuration is memoised per process and captures `DATABASE_URL`
 * and the installed packages on its first call; {@link bootAcmeErpInstance}
 * refuses when the memo already names another database.
 */

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, '..', 'fixtures', 'installed-packages', 'mod-acme-erp');
const SCRATCH = join(here, '..', '.installed-package-instances');

/** The package root inside an instance root. */
export const ACME_ERP_PACKAGE = join('node_modules', '@acme', 'mod-acme-erp');

/** Copy the fixture into a fresh instance root; `edit` may rewrite files of the copy. */
export function installAcmeErp(edit?: (packageRoot: string) => void): { root: string; remove: () => void } {
  mkdirSync(SCRATCH, { recursive: true });
  const root = mkdtempSync(join(SCRATCH, 'instance-'));
  const destination = join(root, ACME_ERP_PACKAGE);
  mkdirSync(destination, { recursive: true });
  cpSync(FIXTURE, destination, { recursive: true });
  edit?.(destination);
  return { root, remove: () => rmSync(root, { recursive: true, force: true }) };
}

/** Rewrite one file of an installed copy. */
export function rewrite(packageRoot: string, relative: string, transform: (source: string) => string): void {
  const path = join(packageRoot, relative);
  writeFileSync(path, transform(readFileSync(path, 'utf8')));
}

export interface AcmeErpInstance {
  readonly root: string;
  readonly databaseUrl: string;
  /** The migration names `migrateUpVerified` applied on the clone, in order. */
  readonly applied: readonly string[];
  /** Restore the environment, drop the database and the instance root. */
  readonly dispose: () => Promise<void>;
}

export async function bootAcmeErpInstance(): Promise<AcmeErpInstance> {
  const baseUrl = process.env[BASE_DATABASE_URL_ENV];
  const template = process.env[TEMPLATE_DATABASE_ENV];
  if (!baseUrl || !template) {
    throw new Error(
      `acme-erp-instance: ${BASE_DATABASE_URL_ENV}/${TEMPLATE_DATABASE_ENV} are not set, so there is no ` +
        `migrated template to clone; run under the backend vitest configuration.`,
    );
  }
  const installed = installAcmeErp();
  const clone = await cloneTemplateForCaller(baseUrl, template);
  const previous = {
    DATABASE_URL: process.env['DATABASE_URL'],
    ENDORA_INSTANCE_ROOT: process.env['ENDORA_INSTANCE_ROOT'],
  };
  const restoreEnv = (): void => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  process.env['DATABASE_URL'] = clone.url;
  process.env['ENDORA_INSTANCE_ROOT'] = installed.root;
  const dispose = async (): Promise<void> => {
    restoreEnv();
    await dropRunDatabase(baseUrl, clone.name, () => {});
    installed.remove();
  };
  try {
    const config = await mikroOrmConfig();
    if (config.clientUrl !== clone.url) {
      throw new Error(
        'acme-erp-instance: the ORM configuration was memoised before the instance was booted, so it ' +
          'names another database. Boot the instance first in the file.',
      );
    }
    const orm = await MikroORM.init(config);
    try {
      const applied = (await migrateUpVerified(orm)).map((migration) => migration.name);
      return { root: installed.root, databaseUrl: clone.url, applied, dispose };
    } finally {
      await orm.close(true);
    }
  } catch (error) {
    await dispose();
    throw error;
  }
}
