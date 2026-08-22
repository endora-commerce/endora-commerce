// Fixture: a fully converted overlay module — `backend.ts` + `manifest.ts`.
import { defineModuleManifest } from '@endora-commerce/contracts';

export const manifest = defineModuleManifest({
  id: 'fixture_composed',
  name: 'Fixture Composed',
  version: '2.3.4',
  dependencies: [],
  activation: { settingCode: 'fixture_composed.activation', default: true },
});
