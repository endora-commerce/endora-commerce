/**
 * `admin_users create` — bootstrap an admin user from the host.
 *
 * Usage:
 *   pnpm --filter backend run admin:create -- \
 *     --email=admin@example.com \
 *     --password='change-me-12+chars' \
 *     --first-name=Plat \
 *     --last-name=Admin
 *
 * Optional:
 *   --role=platform_admin       (default — full wildcard permissions)
 *   --role=order_manager        (must already exist in admin_roles)
 *   --skip-role-bootstrap       (don't auto-create platform_admin if missing)
 *
 * Idempotent: re-running with the same email updates the password and the role
 * assignment instead of failing on the unique constraint.
 *
 * The first admin you create is the bootstrap administrator and gets the
 * `platform_admin` role with the wildcard `*` permission. From there you can use
 * the admin panel's Users + Roles module to define narrower roles.
 *
 * ## Why composing is safe on a database with no administrator in it
 *
 * This file's `check:module-boundary` key was escalated rather than cut, on the
 * ground that *"the bootstrap it performs is the one write that must work on a
 * database with no administrator in it"*. The premise holds; the conclusion did
 * not. `composeApp()` runs `loadModulePresence` **before the first module
 * registers**, and its `reconcileExistingModules` inserts a `state='installed'`
 * row for every shipped manifest that has none — so on a schema straight out of
 * `db:fresh`, where `module_registrations` is empty, presence is loaded and
 * `adminRolePort` resolves to a working port by the time this body runs
 * (D-157.5).
 *
 * What it needed all along was two methods of a port `admin_roles` already
 * publishes and `admin_users` already declares in `dependencies`:
 * `findByCode` and `upsertByCode`. The port was unreachable, not unpublished,
 * and composing is what reaches it. The `AdminRole` **entity** import is gone
 * with the key.
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import { normalizeEmailAddress, type AdminRolePort } from '@b2b/contracts';
import type { ModuleCliCommandContext } from '@b2b/contracts';
import { lazyPort, type ModuleContext } from '../../../kernel/index.js';
import { hashPassword } from '../../../kernel/crypto/password-hasher.js';
import { AdminUser } from '../entities/admin-user.entity.js';

interface ParsedArgs {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: string;
  skipRoleBootstrap: boolean;
}

/** The EntityManager factory every composition supplies. */
interface CreateAdminCradle {
  readonly emFactory: () => EntityManager;
}

export function parseArgs(argv: readonly string[]): ParsedArgs | { error: string } {
  const map = new Map<string, string>();
  let skipRoleBootstrap = false;
  for (const arg of argv) {
    if (arg === '--skip-role-bootstrap') {
      skipRoleBootstrap = true;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq === -1) continue;
    map.set(arg.slice(2, eq), arg.slice(eq + 1));
  }
  for (const key of ['email', 'password', 'first-name', 'last-name']) {
    if (!map.get(key)?.trim()) return { error: `Missing required flag: --${key}=...` };
  }
  const password = (map.get('password') as string).trim();
  if (password.length < 12) return { error: 'Password must be at least 12 characters.' };
  return {
    email: normalizeEmailAddress((map.get('email') as string).trim()),
    password,
    firstName: (map.get('first-name') as string).trim(),
    lastName: (map.get('last-name') as string).trim(),
    role: map.get('role')?.trim() || 'platform_admin',
    skipRoleBootstrap,
  };
}

export async function createAdmin({
  ctx,
  argv,
  out,
  err,
}: ModuleCliCommandContext<ModuleContext>): Promise<number> {
  // command-coverage-ignore: the bootstrap CLI that mints the first
  // administrator. It runs with shell access to the deployment and, by
  // construction, before any Admin User exists — so there is no acting
  // principal for the Command Bus to attribute the write to. Every subsequent
  // admin-user write goes through the audited admin_users surface; this one
  // exists so that surface has somebody to sign in to it.
  const args = parseArgs(argv);
  if ('error' in args) {
    err(args.error);
    return 1;
  }

  const adminRoles = lazyPort<AdminRolePort>(ctx, 'adminRolePort');
  const em = ctx.cradle<CreateAdminCradle>().emFactory();

  // 1. Resolve or bootstrap the role — two methods of the port `admin_roles`
  //    publishes, in place of a `findOne` + `em.create` over its entity.
  let role = await adminRoles.findByCode(args.role);
  if (!role) {
    if (args.skipRoleBootstrap || args.role !== 'platform_admin') {
      err(
        `Role "${args.role}" not found. Either create it via the admin panel or omit ` +
          `--role to bootstrap the platform_admin role.`,
      );
      return 1;
    }
    role = await adminRoles.upsertByCode({
      code: 'platform_admin',
      name: 'Platform Admin',
      permissions: ['*'],
      requiresTwoFactor: false,
    });
    out(`Created bootstrap role: platform_admin (${role.id})`);
  }

  // 2. Upsert the admin user — this module's own table, written directly for
  //    the reason the ignore marker above gives.
  const passwordHash = await hashPassword(args.password);
  const existing = await em.findOne(AdminUser, { email: args.email });
  if (existing) {
    existing.passwordHash = passwordHash;
    existing.firstName = args.firstName;
    existing.lastName = args.lastName;
    existing.adminRoleId = role.id;
    existing.status = 'active';
    existing.deletedAt = null;
    await em.flush();
    out(`Updated existing admin: ${args.email}`);
    out(`  id   : ${existing.id}`);
    out(`  role : ${role.code} (${role.id})`);
  } else {
    const created = em.create(AdminUser, {
      email: args.email,
      passwordHash,
      firstName: args.firstName,
      lastName: args.lastName,
      adminRoleId: role.id,
      status: 'active',
    });
    await em.persistAndFlush(created);
    out(`Created admin: ${args.email}`);
    out(`  id   : ${created.id}`);
    out(`  role : ${role.code} (${role.id})`);
  }
  out('');
  out('Sign in at the admin panel with the email + password above.');
  return 0;
}
