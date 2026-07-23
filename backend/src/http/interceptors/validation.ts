import type { ApiInterceptorRegistry } from './registry.js';
import type { RouteTable } from './route-table.js';

/**
 * Boot-time validation of interceptor targets (feature 060, FR-010/SC-007).
 * Runs in `buildServer`'s onReady hook, after every module has registered its
 * routes and before any traffic is served. Fail-closed: a typo'd target
 * refuses startup instead of silently never firing — mirroring the overlay
 * pattern's UnknownOverrideTargetError stance (Constitution XV).
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
