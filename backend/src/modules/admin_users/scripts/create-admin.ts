/**
 * Bootstrap an admin user from the CLI.
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
 * Idempotent: re-running with the same email updates the password + role
 * assignment instead of failing on the unique constraint.
 *
 * The first admin you create is the bootstrap administrator and gets the
 * `platform_admin` role with the wildcard `*` permission. From there you
 * can use the admin panel's Users + Roles module to define narrower roles.
 */

import { initOrm, closeOrm } from '../../../db/index.js';
import { AdminUser } from '../entities/admin-user.entity.js';
import { AdminRole } from '../../admin_roles/entities/admin-role.entity.js';
import { hashPassword } from '../../auth/services/password-hasher.js';
import { enterSystemScope } from '../../../kernel/scope.js';

interface ParsedArgs {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: string;
  skipRoleBootstrap: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
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
    const key = arg.slice(2, eq);
    const value = arg.slice(eq + 1);
    map.set(key, value);
  }
  const required = (k: string): string => {
    const v = map.get(k)?.trim();
    if (!v) {
      console.error(`Missing required flag: --${k}=...`);
      process.exit(1);
    }
    return v;
  };
  return {
    email: required('email').toLowerCase(),
    password: required('password'),
    firstName: required('first-name'),
    lastName: required('last-name'),
    role: map.get('role')?.trim() || 'platform_admin',
    skipRoleBootstrap,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.password.length < 12) {
    console.error('Password must be at least 12 characters.');
    process.exit(1);
  }

  const orm = await initOrm();
  try {
    const em = orm.em.fork();

    // 1. Resolve or bootstrap the role.
    let role = await em.findOne(AdminRole, { code: args.role });
    if (!role) {
      if (args.skipRoleBootstrap || args.role !== 'platform_admin') {
        console.error(
          `Role "${args.role}" not found. Either create it via the admin panel ` +
            `or omit --role to bootstrap the platform_admin role.`,
        );
        process.exit(1);
      }
      role = em.create(AdminRole, {
        code: 'platform_admin',
        name: 'Platform Admin',
        permissions: ['*'],
        requiresTwoFactor: false,
      });
      await em.persistAndFlush(role);
      console.log(`Created bootstrap role: platform_admin (${role.id})`);
    }

    // 2. Upsert the admin user.
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
      console.log(`Updated existing admin: ${args.email}`);
      console.log(`  id   : ${existing.id}`);
      console.log(`  role : ${role.code} (${role.id})`);
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
      console.log(`Created admin: ${args.email}`);
      console.log(`  id   : ${created.id}`);
      console.log(`  role : ${role.code} (${role.id})`);
    }
    console.log('\nSign in at the admin panel with the email + password above.');
  } finally {
    await closeOrm();
  }
}

void enterSystemScope('cli: create an admin user', main, { entryPoint: 'cli' }).catch((err: unknown) => {
  console.error('admin:create failed', err);
  process.exit(1);
});
