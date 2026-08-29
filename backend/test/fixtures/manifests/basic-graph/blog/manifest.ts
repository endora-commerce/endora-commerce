import { defineModuleManifest } from '@endora-commerce/contracts';

export const manifest = defineModuleManifest({
  id: 'blog',
  name: 'Blog',
  version: '1.0.0',
  dependencies: ['settings', 'sales_channels'],
});
