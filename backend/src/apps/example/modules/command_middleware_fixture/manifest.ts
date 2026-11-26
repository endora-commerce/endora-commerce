// Example deployment — the command-middleware fixture
// (`specs/189-command-middleware/` T023, T030).
//
// It stands in for the deployment US1–US3 are about: one that refuses some
// Commands and observes others through declared command middleware rather than
// by wrapping `commandBus`. The contract and integration tests that compose it
// hold three properties: an `admit` refuses a matching Command — children
// included — with the module's own translated code before anything is written;
// an `observe` runs after the run settled, in the caller's tenant context; and
// switched off, both behave as if the module were not installed (XVII).
//
// **It acts only on a marked request.** `example` is the reference deployment
// many suites compose, so a Command whose request id does not start with
// `COMMAND_MIDDLEWARE_FIXTURE_MARKER` passes through untouched and nothing else
// in the deployment can tell the module is there.

import {
  defineModuleErrorCodes,
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@endora-commerce/contracts';

export const COMMAND_MIDDLEWARE_FIXTURE_SETTING_CODES = {
  ACTIVATION: 'command_middleware_fixture.enabled',
} as const;

/** A request the fixture observes carries an `x-request-id` starting with this. */
export const COMMAND_MIDDLEWARE_FIXTURE_MARKER = 'cmdmw-';
/** …and one whose `organization.` Commands it refuses starts with this. */
export const COMMAND_MIDDLEWARE_FIXTURE_HOLD = 'cmdmw-hold-';

/** The fixture's own refusal code: declared below, translated in its own bundle. */
export const commandMiddlewareFixtureErrorCodes = defineModuleErrorCodes(['COMMAND_MIDDLEWARE_FIXTURE_REFUSED']);

const settings = defineModuleSettingsManifest({
  moduleCode: 'command_middleware_fixture',
  groups: [{ code: 'command_middleware_fixture', name: 'Command middleware fixture' }],
  settings: [
    {
      code: COMMAND_MIDDLEWARE_FIXTURE_SETTING_CODES.ACTIVATION,
      name: 'Command middleware fixture enabled',
      description:
        'Switches this example-deployment fixture on or off. It refuses organization writes of a request whose id carries its hold marker, and records the runs of a marked request, to show the command-middleware point end to end; switched off, both are skipped and nothing else changes.',
      groupCode: 'command_middleware_fixture',
      valueType: 'boolean',
      defaultValue: true,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'command_middleware_fixture',
  name: 'Command middleware fixture',
  description:
    'Example-deployment fixture: an admit and an observe command middleware on organization Commands, so the command-middleware point has a contributor in this repository.',
  version: '1.0.0',
  // `settings` carries the activation control. Middleware attaches to no
  // owner, so nothing else is a dependency.
  dependencies: ['settings'],
  activation: { settingCode: COMMAND_MIDDLEWARE_FIXTURE_SETTING_CODES.ACTIVATION, default: true },
  settings,
  i18n: { bundlesDir: 'i18n' },
  errorCodes: [{ code: 'COMMAND_MIDDLEWARE_FIXTURE_REFUSED' }],
  commandMiddleware: [
    { id: 'hold-marked', phase: 'admit', actions: ['organization.'] },
    { id: 'record-marked', phase: 'observe', actions: ['organization.'] },
  ],
});
