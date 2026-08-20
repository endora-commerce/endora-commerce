// Fixture: an overlay module directory with NO `backend.ts`.
//
// It must be SKIPPED rather than thrown at. This is the shape that crashed
// composition before D-103: `loadOverlayModulePlugins` imported `plugin.ts` for
// every discovered id without asking whether the file existed.
import { defineModuleManifest } from '@b2b/contracts';

export const manifest = defineModuleManifest({
  id: 'fixture_manifest_only',
  name: 'Fixture Manifest Only',
  version: '1.0.0',
  dependencies: [],
  activation: { settingCode: 'fixture_manifest_only.activation', default: true },
});
