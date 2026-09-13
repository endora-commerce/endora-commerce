/**
 * Why inventory's environment inputs are not Settings
 * (`specs/117-instance-bring-up/contracts/environment-inputs.md` §4).
 *
 * Two-way: a declaration with no entry here fails the build, and an entry
 * naming a variable this module no longer declares fails it too. Delete the
 * file when its last entry goes.
 */
export const entries = {
  INVENTORY_LOW_STOCK_RECIPIENT: {
    classification: 'configuration' as const,
    reason:
      'The clearest `configuration` in this ledger, because the Setting **already exists**: ' +
      '`resolveRecipient()` reads ' +
      '`INVENTORY_SETTING_CODES.LOW_STOCK_ALERT_RECIPIENT_EMAIL` first and falls back to ' +
      'this variable only when the Setting is empty ' +
      '(`services/low-stock-alert-service.ts:176-190`). So there is nothing to design and ' +
      'nothing to migrate to — the repair is to delete the fallback, once somebody has ' +
      'checked no deployment is relying on it. It is the one entry here whose retirement ' +
      'costs a decision rather than a design.',
  },
};
