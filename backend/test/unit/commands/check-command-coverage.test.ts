import { describe, expect, it } from 'vitest';
import {
  analyzeSource,
  findingsFor,
  isMigratedServicePath,
} from '../../../scripts/check-command-coverage.js';

/** Fixture path under a service dir so the migrated-scope check applies. */
const PATH = 'src/modules/catalog/services/thing.service.ts';

describe('command coverage check (feature 054, FR-009 / FR-010)', () => {
  it('flags an un-migrated sensitive write (mutation, no Command, no audit)', () => {
    const src = `
      export class ThingService {
        constructor(private em: () => any) {}
        async rename(id: string) {
          const em = this.em();
          const t = await em.findOne('Thing', { id });
          t.name = 'x';
          await em.persistAndFlush(t);
        }
      }`;
    const findings = findingsFor(PATH, analyzeSource(PATH, src));
    expect(findings.map((f) => f.kind)).toEqual(['unaudited-sensitive-write']);
  });

  it('passes a write expressed as a Command (no manual audit)', () => {
    const src = `
      export class ThingService {
        constructor(private commandBus: any) {}
        rename(id: string) {
          return this.commandBus.run(new RenameThingCommand(id));
        }
      }`;
    const a = analyzeSource(PATH, src);
    expect(a.runsCommand).toBe(true);
    expect(findingsFor(PATH, a)).toEqual([]);
  });

  it('passes a legacy write that still audits by hand (no mutation-without-coverage)', () => {
    const src = `
      export class ThingService {
        constructor(private em: () => any, private auditLog: any) {}
        async rename(id: string) {
          const em = this.em();
          await em.persistAndFlush({ id });
          await this.auditLog.record({ action: 'thing.rename', objectType: 'thing', objectId: id });
        }
      }`;
    expect(findingsFor(PATH, analyzeSource(PATH, src))).toEqual([]);
  });

  it('flags a double-audit: runs a Command AND records audit by hand', () => {
    const src = `
      export class ThingService {
        constructor(private commandBus: any, private auditLogService: any) {}
        async rename(id: string) {
          await this.commandBus.run(new RenameThingCommand(id));
          await this.auditLogService.record({ action: 'thing.rename', objectType: 'thing', objectId: id });
        }
      }`;
    const findings = findingsFor(PATH, analyzeSource(PATH, src));
    expect(findings.map((f) => f.kind)).toContain('double-audit');
  });

  it('scopes build-breaking to migrated modules', () => {
    expect(isMigratedServicePath('src/modules/catalog/services/x.ts', ['catalog'])).toBe(true);
    expect(isMigratedServicePath('src/modules/catalog/services/x.ts', ['pricing'])).toBe(false);
    expect(isMigratedServicePath('src/modules/catalog/services/x.ts', [])).toBe(false);
  });
});
