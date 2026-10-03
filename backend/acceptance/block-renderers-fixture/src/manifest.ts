/**
 * The manifest of a synthetic third-party module that draws its own Page
 * Builder block (`specs/141-module-block-renderers/`, acceptance A1–A8).
 *
 * A plain object, as a third party's emitted manifest is: this file imports
 * nothing, so the fixture's manifest cannot acquire a value from the repository
 * that hosts it.
 */

/** The Setting that holds the operator's on/off choice for this module. */
export const ACCEPTANCE_BLOCKS_ACTIVATION_SETTING = 'acceptance_blocks.activation';

export const manifest = {
  id: 'acceptance_blocks',
  name: 'Acceptance Blocks',
  description:
    'Synthetic third-party module. It exists to prove that a module package renders its own Page Builder block on the storefront, in the admin editors and in e-mail.',
  version: '1.0.0',
  // `email` owns the registry this module registers its e-mail renderer into.
  // It is non-deactivatable, so the edge never fails closed.
  dependencies: ['email'],
  activation: {
    settingCode: ACCEPTANCE_BLOCKS_ACTIVATION_SETTING,
    default: true,
  },
  settings: {
    moduleCode: 'acceptance_blocks',
    groups: [{ code: 'acceptance_blocks', name: 'Acceptance Blocks' }],
    settings: [
      {
        code: ACCEPTANCE_BLOCKS_ACTIVATION_SETTING,
        name: 'Acceptance blocks enabled',
        description:
          'Switches the acceptance-blocks module on or off as a whole: its block stops rendering on every surface and is no longer offered in a palette.',
        groupCode: 'acceptance_blocks',
        valueType: 'boolean',
        defaultValue: true,
      },
    ],
  },
  i18n: { bundlesDir: 'i18n' },
  blockCategories: [
    { key: 'acceptance', titleKey: 'blocks.section', contexts: ['cms', 'email'], weight: 900 },
  ],
  blocks: [
    {
      // The persisted name — `<endora.id>.<Name>`, and permanent. Written as a
      // literal: `endora check` reads a block's name and contexts off the
      // manifest's text, and a name it cannot read is one it cannot hold a
      // renderer to.
      name: 'acceptance_blocks.Badge',
      labelKey: 'blocks.badge.label',
      descriptionKey: 'blocks.badge.description',
      category: 'acceptance',
      contexts: ['cms', 'email'],
      fields: {
        text: { type: 'text', label: 'Text' },
        // Forces every renderer of this block to throw. It exists for the
        // failure-isolation assertion and for nothing an operator would use.
        explode: {
          type: 'radio',
          label: 'Fail on render',
          options: [
            { label: 'No', value: 'no' },
            { label: 'Yes', value: 'yes' },
          ],
        },
      },
      defaultProps: { text: 'New badge', explode: 'no' },
      weight: 10,
    },
  ],
};
