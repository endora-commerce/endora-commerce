import type {
  SettingNotice,
  SettingNoticeInput,
  SettingNoticeProvider,
  SettingNoticeRegistryPort,
} from '@endora-commerce/contracts';
import type { ModulePresencePort } from './settings-admin.service.js';

/**
 * Where the module that declared a setting says that what is stored is not
 * what is in force — issue #930.
 *
 * The write validators' twin on the read side, with the same division of
 * labour: `settings` serves the stored value and never learns why it might not
 * apply; the owning module knows, and says so. Without this a setting reads
 * "on" on the Settings screen while doing nothing, which is the defect class
 * #349 was filed about.
 *
 * **Absent-contributor policy: `skip`**, as for the validators: a module that
 * is off does not answer for a code.
 */
export class SettingNoticeRegistry implements SettingNoticeRegistryPort {
  private readonly providers: SettingNoticeProvider[] = [];

  constructor(
    /** Absent in a composition with no lifecycle (unit tests): every contributor counts as present. */
    private readonly presence?: Pick<ModulePresencePort, 'presenceOf'>,
  ) {}

  register(provider: SettingNoticeProvider): void {
    this.providers.push(provider);
  }

  forCode(code: string): readonly SettingNoticeProvider[] {
    return this.providers.filter(
      (provider) =>
        provider.codes.includes(code) &&
        (this.presence?.presenceOf(provider.contributorModuleId) ?? true),
    );
  }

  async noticeFor(input: SettingNoticeInput): Promise<SettingNotice | null> {
    for (const provider of this.forCode(input.code)) {
      const notice = await provider.notice(input);
      if (notice !== null) return notice;
    }
    return null;
  }
}
