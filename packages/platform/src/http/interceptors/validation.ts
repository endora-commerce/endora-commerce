import type { ApiInterceptorRegistry } from './registry.js';
import type { RouteTable } from './route-table.js';

/**
 * Boot-time validation of interceptor targets (feature 060, FR-010/SC-007).
 * Runs in `buildServer`'s onReady hook, after every module has registered its
 * routes and before any traffic is served. Fail-closed: a typo'd target
 * refuses startup instead of silently never firing (Constitution XV).
 *
 * This used to cite the overlay pattern's `UnknownOverrideTargetError` as the
 * precedent. That refusal is retired with the file-shadowing mechanism it
 * guarded (D-201, feature 103) — and it was the wrong precedent by then
 * anyway: it had been unreachable since the core module index emptied, so what
 * it cited was a promise nothing kept. The stance is right on its own terms; a
 * mechanism that cannot fire is not a mechanism a second one should model
 * itself on.
 *
 * A target owned by a currently-disabled module is NOT an error: the route is
 * still mounted (it 503s via defineModuleRoutes gating) and the interceptor
 * is simply inert until the module is enabled.
 */
export function validateRegistrations(
  registry: ApiInterceptorRegistry,
  routeTable: RouteTable,
): void {
  const problems: string[] = [];
  for (const reg of registry.registrations()) {
    for (const target of reg.targets) {
      const route = routeTable.get(target);
      if (!route) {
        problems.push(
          `module '${reg.module}' interceptor '${reg.id}' targets unknown endpoint '${target}' — ` +
            `no such route is mounted in this deployment.`,
        );
        continue;
      }
      if (reg.phase === 'post' && route.streamingResponse) {
        problems.push(
          `module '${reg.module}' interceptor '${reg.id}' declares phase 'post' on streaming endpoint ` +
            `'${target}' — streaming/binary payloads bypass serialization and cannot be reshaped.`,
        );
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `[api-interceptor] boot validation failed:\n  - ${problems.join('\n  - ')}`,
    );
  }
}
