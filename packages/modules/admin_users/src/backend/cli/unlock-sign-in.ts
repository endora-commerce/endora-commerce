/**
 * `admin_users unlock` — clear the authentication throttle for one account.
 *
 * Usage, from the root of an instance:
 *   pnpm run cli admin_users unlock --email=admin@example.com
 *
 * The throttle delays sign-in after repeated wrong passwords or codes. A device
 * the account has already been used from is not affected by wrong attempts
 * made elsewhere; a device it has never been used from is, for as long as
 * somebody keeps sending them. This command is the way out for that case: it
 * forgets every counter of the account, so the next attempt from anywhere is
 * admitted. Sign in straight after running it — the device then becomes a
 * known one.
 *
 * It needs a shell on the instance, which is the trust it should need: it runs
 * against the instance's own Redis and nothing reaches it over HTTP.
 *
 * It does not change the password, end any session or touch the second factor.
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import { normalizeEmailAddress } from '@endora-commerce/contracts';
import type { ModuleCliCommandContext } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { AdminUser } from '../entities/admin-user.entity.js';

/** What this command resolves from the composed module. */
interface UnlockCradle {
  readonly emFactory: () => EntityManager;
  readonly admin: {
    readonly handle: {
      readonly authenticationThrottle: {
        clear(account: { email: string; adminUserId?: string }): Promise<number>;
        describeStore(): string;
      };
    };
  };
}

export function parseUnlockArgs(argv: readonly string[]): { email: string } | { error: string } {
  const flag = argv.find((arg) => arg.startsWith('--email='));
  const email = flag?.slice('--email='.length).trim();
  if (!email) return { error: 'Missing required flag: --email=...' };
  return { email: normalizeEmailAddress(email) };
}

export async function unlockSignIn({
  ctx,
  argv,
  out,
  err,
}: ModuleCliCommandContext<ModuleContext>): Promise<number> {
  const args = parseUnlockArgs(argv);
  if ('error' in args) {
    err(args.error);
    return 1;
  }
  const cradle = ctx.cradle<UnlockCradle>();
  const throttle = cradle.admin.handle.authenticationThrottle;
  // Said first and in both outcomes. The command acts on whichever Redis its
  // environment names, and "nothing was throttled" from the wrong one reads
  // exactly like "that account was not throttled".
  out(`Redis: ${throttle.describeStore()}`);
  const admin = await cradle.emFactory().findOne(AdminUser, { email: args.email });
  const removed = await throttle.clear({
    email: args.email,
    ...(admin ? { adminUserId: admin.id } : {}),
  });

  if (!admin) {
    // Said, because a mistyped address would otherwise look like a success.
    // The counters for the address are cleared all the same: they exist
    // whether or not an account does.
    out(`No administrator account has the address ${args.email}.`);
  }
  out(
    removed === 0
      ? `Nothing was throttled for ${args.email} in that Redis. If sign-in is being refused, ` +
        'check that this command ran against the Redis the instance uses.'
      : `Cleared the authentication throttle for ${args.email} (${removed} counter keys).`,
  );
  if (admin) out('Sign in now: the device you sign in on is then remembered for this account.');
  return 0;
}
