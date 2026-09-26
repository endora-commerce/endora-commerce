/**
 * Whether this process runs queue consumers — Principle X's deployment dial,
 * read once, by the platform that declares `BACKEND_ROLE`
 * (`packages/platform/src/env/index.ts`):
 *
 *   - unset / `'all'` → API and co-located consumers (the single-VPS default)
 *   - `'api'`         → HTTP only; the consumers run in a separate worker process
 *   - `'worker'`      → consumers only (set by the worker entry point)
 *
 * `composeApp` registers the answer as the host value `processRunsWorkers`, the
 * one module-agnostic switch a module that starts consumers reads
 * (`specs/134-paid-module-extraction/` research D16, contract W1.1). A module
 * never reads the role itself: a fourth role value would then have to be taught
 * to every module with a worker.
 */
export function processRunsWorkersFor(backendRole: string | undefined): boolean {
  return (backendRole ?? 'all') !== 'api';
}
