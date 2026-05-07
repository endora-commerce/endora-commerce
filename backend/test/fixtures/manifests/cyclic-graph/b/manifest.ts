import { defineModuleManifest } from '@b2b/contracts';

export const manifest = defineModuleManifest({
  id: 'b',
  name: 'Cyclic B',
  version: '1.0.0',
  dependencies: ['a'],
});
