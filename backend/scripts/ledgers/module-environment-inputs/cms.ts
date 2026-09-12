/**
 * Why cms's environment inputs are not Settings
 * (`specs/117-instance-bring-up/contracts/environment-inputs.md` §4).
 *
 * Two-way: a declaration with no entry here fails the build, and an entry
 * naming a variable this module no longer declares fails it too. Delete the
 * file when its last entry goes.
 */
export const entries = {
  CMS_PB_BREAKPOINT_TABLET_MIN: {
    classification: 'configuration' as const,
    reason:
      'An editorial preview width, and a property of the storefront theme rather than of the ' +
      'deployment. `resolvePageBuilderBreakpointsFromEnv()` is called to seed the module’s ' +
      'own settings defaults, which is the shape that makes this one worth reading twice: ' +
      'the value is already on its way into the settings store, and the environment variable ' +
      'is the seed rather than the home. The repair is to drop the seed once the Setting has ' +
      'a value everywhere.',
  },
  CMS_PB_BREAKPOINT_DESKTOP_MIN: {
    classification: 'configuration' as const,
    reason:
      'The same variable one breakpoint over, with the same repair. Both are read in ' +
      '`manifest.ts` itself, which is the one place in this tree where a manifest is not ' +
      'pure data — worth knowing if you are reading the manifest as text, as ' +
      '`check:env-inputs` does.',
  },
};
