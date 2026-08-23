import type { FastifyRequest } from 'fastify';

/**
 * Local narrowing for the test harness's `request.testActor` decoration.
 *
 * `test/helpers/test-actors.ts` declares a global `fastify` module augmentation
 * adding `testActor` to `FastifyRequest`. That file lives under `test/`, which
 * `tsconfig.build.json` excludes — so production code that reads the field
 * through the *global* augmentation typechecks under `tsconfig.json` (which
 * includes tests) but fails `pnpm run build`.
 *
 * Production route handlers therefore narrow the field locally through this
 * carrier type instead. It intentionally mirrors only the admin shape actually
 * consumed by `src/` — the full `TestActor` union stays test-only, and no
 * test-only type is added to the production `FastifyRequest` surface.
 */
export interface TestActorCarrier {
  testActor?: { kind: string; adminUserId: string };
}

/**
 * Returns the harness-supplied admin user id, or `undefined` when the request
 * carries no admin `testActor`. Production requests resolve their actor through
 * the auth plugin (`request.actor`) and always get `undefined` here.
 */
export function testAdminUserId(request: FastifyRequest): string | undefined {
  const testActor = (request as FastifyRequest & TestActorCarrier).testActor;
  return testActor?.kind === 'admin' ? testActor.adminUserId : undefined;
}
