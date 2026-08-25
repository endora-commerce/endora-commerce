import type { FastifyRequest } from 'fastify';

/**
 * The signed-in customer behind a request, or `null`.
 *
 * `request.actor` is not on `FastifyRequest`: it is a declaration-merging
 * augmentation the `auth` module contributes (`modules/auth/plugin.ts`). Inside
 * `backend/src` that augmentation arrived ambiently through the host's own
 * `types` graph, so nothing in this module ever named it. A package compiles
 * against its own manifest and `auth` publishes nothing a package can name — it
 * is the one module still holding an unpublished platform reach — so the
 * property is simply not there (TS2339).
 *
 * So the shape is read structurally, in **one** place rather than at each of the
 * three call sites, and it is the same door `admin_notifications` already uses
 * for the admin half of the same augmentation. It narrows rather than asserts:
 * a request carrying no actor, or an actor of another kind, answers `null`, so
 * the anonymous `compare_token` path is reached exactly as before.
 */
export function customerActor(request: FastifyRequest): { customerAccountId: string } | null {
  const { actor } = request as FastifyRequest & {
    actor?: { kind?: string; customerAccountId?: string };
  };
  if (actor?.kind !== 'customer' || typeof actor.customerAccountId !== 'string') return null;
  return { customerAccountId: actor.customerAccountId };
}
