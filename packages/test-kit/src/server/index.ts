/**
 * `./server` — compose a platform for a test, and take it down again
 * (feature 109, R1.1).
 *
 * `composeTestServer` and `teardownTestServer`, and the two types they take and
 * return. Everything the caller supplies is `PlatformComposition`
 * (`./composition.ts`) plus the four hooks the boot order makes load-bearing;
 * everything the kit owns is on `TestServerHandle`, and **not one field of it
 * names a module**.
 */

export {
  composeTestServer,
  teardownTestServer,
  type ComposedPlatformContext,
  type ComposeTestServerOptions,
  type TestPlatformContext,
  type TestServerHandle,
} from './compose-test-server.js';

export type {
  ComposedManifestEntry,
  PlatformComposition,
  TestOrmLifecycle,
} from './composition.js';
