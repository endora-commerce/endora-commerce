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
/** Where a provider's failure is reported: `ctx.log`'s shape. */
export interface SettingNoticeLog {
  error(fields: Record<string, unknown>, message: string): void;
}

export class SettingNoticeRegistry implements SettingNoticeRegistryPort {
  /** Keyed by setting code: every read of a settings list asks once per row. */
  private readonly byCode = new Map<string, SettingNoticeProvider[]>();

  constructor(
    /** Absent in a composition with no lifecycle (unit tests): every contributor counts as present. */
    private readonly presence?: Pick<ModulePresencePort, 'presenceOf'>,
    private readonly log?: SettingNoticeLog,
  ) {}

  register(provider: SettingNoticeProvider): void {
    for (const code of provider.codes) {
      const providers = this.byCode.get(code);
      if (providers) providers.push(provider);
      else this.byCode.set(code, [provider]);
    }
  }

  forCode(code: string): readonly SettingNoticeProvider[] {
    return (this.byCode.get(code) ?? []).filter(
      (provider) => this.presence?.presenceOf(provider.contributorModuleId) ?? true,
    );
  }

  /**
   * A notice is commentary on a value the screen already shows, so a provider
   * that fails costs its notice and nothing else: it is logged, with who
   * contributed it and for which code, and the next provider is asked. Caught
   * here, in the one service that calls providers, rather than around each
   * caller's resolved port, so no read path can forget it.
   */
  async noticeFor(input: SettingNoticeInput): Promise<SettingNotice | null> {
    for (const provider of this.forCode(input.code)) {
      try {
        const notice = await provider.notice(input);
        if (notice !== null) return notice;
      } catch (error) {
        this.log?.error(
          { err: error, contributorModuleId: provider.contributorModuleId, settingCode: input.code },
          `A setting notice provider failed; the setting is shown without its notice.`,
        );
      }
    }
    return null;
  }
}
