import { defineModuleManifest } from '@endora-commerce/contracts';

export const manifest = defineModuleManifest({
  id: 'b',
  name: 'Cyclic B',
  version: '1.0.0',
  dependencies: ['a'],
});
