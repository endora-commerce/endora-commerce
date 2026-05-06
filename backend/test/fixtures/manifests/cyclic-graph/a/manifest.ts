import { defineModuleManifest } from '@b2b/contracts';

export const manifest = defineModuleManifest({
  id: 'a',
  name: 'Cyclic A',
  version: '1.0.0',
  dependencies: ['b'],
});
