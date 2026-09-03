// Fixture: an overlay module claiming a module id core already owns.
//
// `blog` is a registered module of this platform, so this directory is the
// state FR-004 refuses: two claimants for one id, which is the identity
// migrations are ordered and reverted by, settings and permissions are
// namespaced by, and the lifecycle registry is keyed on.
import { defineModuleManifest } from '@endora-commerce/contracts';

export const manifest = defineModuleManifest({
  id: 'blog',
  name: 'Fixture Colliding Blog',
  version: '9.9.9',
  dependencies: [],
  activation: { settingCode: 'blog.activation', default: true },
});
