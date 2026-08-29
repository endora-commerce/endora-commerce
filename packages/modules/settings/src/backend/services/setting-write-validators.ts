import type {
  SettingWriteValidator,
  SettingWriteValidatorRegistryPort,
} from '@endora-commerce/contracts';
import type { ModulePresencePort } from './settings-admin.service.js';

/**
 * Where a module says whether the value another module is about to store is
 * legal — feature 078, D-95.2.
 *
 * The division of labour is the whole point of the seam:
 *
 * > `settings` answers "what would every channel's value be after this write".
 * > The module that declared the setting answers "is that legal".
 *
 * `settings` owns three-tier resolution and keeps owning it; it never learns
 * what an invoice number is. `invoices` never re-derives the resolution.
 *
 * **Absent-contributor policy: `skip`.** A validator whose contributing module
 * is not effectively present is not enumerated, so its refusal does not answer
 * for a module an operator switched off.
 *
 * That filter is redundant today, and it is written anyway. `assertWritable`
 * already refuses every write to a switched-off module's settings before
 * validation runs — but that refusal has one exception, a module's own
 * activation control, and a second exception added later must not silently let
 * an absent module's validator answer for a code.
 */
export class SettingWriteValidatorRegistry implements SettingWriteValidatorRegistryPort {
  private readonly validators: SettingWriteValidator[] = [];

  constructor(
    /**
     * Absent in a composition with no lifecycle (unit tests): every contributor
     * then counts as present, which is the pre-073 behaviour rather than a
     * fall-open — there is no activation axis to resolve at all.
     */
    private readonly presence?: ModulePresencePort,
  ) {}

  register(validator: SettingWriteValidator): void {
    this.validators.push(validator);
  }

  forCode(code: string): readonly SettingWriteValidator[] {
    return this.validators.filter(
      (validator) =>
        validator.codes.includes(code) &&
        (this.presence?.presenceOf(validator.contributorModuleId) ?? true),
    );
  }
}
