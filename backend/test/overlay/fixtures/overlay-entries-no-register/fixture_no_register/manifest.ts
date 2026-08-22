// Fixture: a `backend.ts` that exports no `registerModule`.
import { defineModuleManifest } from '@endora-commerce/contracts';

export const manifest = defineModuleManifest({
  id: 'fixture_no_register',
  name: 'Fixture No Register',
  version: '1.0.0',
  dependencies: [],
  activation: { settingCode: 'fixture_no_register.activation', default: true },
});
