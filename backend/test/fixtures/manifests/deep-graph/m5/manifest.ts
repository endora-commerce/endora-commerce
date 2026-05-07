import { defineModuleManifest } from '@b2b/contracts';

export const manifest = defineModuleManifest({
  id: 'm5',
  name: 'Deep Graph 5',
  version: '1.0.0',
  dependencies: ['m4'],
});
