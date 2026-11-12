// Example deployment — the command-hook fixture (`specs/176-command-hooks-outbox/`
// P2, T029).
//
// It stands in for the instance package US2 is about: a module that is not
// `organizations` and takes part in an Organization write through the seam
// `organizations` publishes — `ORGANIZATION_HOOKABLE_ACTIONS` — rather than by
// decorating or forking anything. The contract test that composes it holds the
// three properties the seam promises: the hook's write commits with the core
// row, its veto reaches the caller as its own translated code, and switched off
// it behaves as if never installed.
//
// **It acts only on a marked name.** `example` is the reference deployment many
// suites compose, so an Organization whose name does not start with
// `COMMAND_HOOK_FIXTURE_MARKER` passes through untouched and nothing else in the
// deployment can tell the module is there.

import {
  defineModuleErrorCodes,
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@endora-commerce/contracts';

export const COMMAND_HOOK_FIXTURE_SETTING_CODES = {
  ACTIVATION: 'command_hook_fixture.enabled',
} as const;

/** An Organization name the fixture acts on starts with this. */
export const COMMAND_HOOK_FIXTURE_MARKER = 'CMDHOOK ';
/** …and one it refuses also contains this. */
export const COMMAND_HOOK_FIXTURE_VETO = 'VETO';

/** The fixture's own veto code: declared below, translated in its own bundle. */
export const commandHookFixtureErrorCodes = defineModuleErrorCodes(['COMMAND_HOOK_FIXTURE_REFUSED']);

/**
 * An activation control, because the off state is one of the three properties
 * the fixture exists to show (Principle XVII): switched off, its hooks are
 * skipped per call and the write behaves as if the module were not installed.
 */
const settings = defineModuleSettingsManifest({
  moduleCode: 'command_hook_fixture',
  groups: [{ code: 'command_hook_fixture', name: 'Command hook fixture' }],
  settings: [
    {
      code: COMMAND_HOOK_FIXTURE_SETTING_CODES.ACTIVATION,
      name: 'Command hook fixture enabled',
      description:
        'Switches this example-deployment fixture on or off. It hooks the creation and the self-registration of an Organization whose name carries its marker, to show the command-hook seam end to end; switched off, its hooks are skipped and nothing else changes.',
      groupCode: 'command_hook_fixture',
      valueType: 'boolean',
      defaultValue: true,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'command_hook_fixture',
  name: 'Command hook fixture',
  description:
    'Example-deployment fixture: beforeCommit hooks on organization.create and organization.register, so the command-hook seam has a hook module in this repository.',
  version: '1.0.0',
  // The hooks attach to `organizations`' actions, so `organizations` is a
  // dependency — composition refuses a hook module whose dependencies do not
  // reach the owner. `settings` carries the activation control.
  dependencies: ['organizations', 'settings'],
  activation: { settingCode: COMMAND_HOOK_FIXTURE_SETTING_CODES.ACTIVATION, default: true },
  settings,
  i18n: { bundlesDir: 'i18n' },
  errorCodes: [{ code: 'COMMAND_HOOK_FIXTURE_REFUSED' }],
});
