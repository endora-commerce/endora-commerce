import { describe, expect, it } from 'vitest';
import { AwilixResolutionError, InjectionMode, asClass } from 'awilix';
import type { MikroORM } from '@mikro-orm/postgresql';
import {
  createRootContainer,
  installShutdownDisposal,
  registerOrm,
} from '../../../src/kernel/container.js';

/**
 * The root container's construction options are not preferences — each one
 * removes a class of silent failure that `composition.ts` has today.
 */

/** Minimal MikroORM stand-in: `forkScopedEm` only calls `orm.em.fork()`. */
function fakeOrm(): MikroORM {
  let forks = 0;
  return {
    em: { fork: () => ({ id: (forks += 1) }) },
  } as unknown as MikroORM;
}

describe('kernel root container', () => {
  it('is built with InjectionMode.PROXY so registrations take one cradle argument', () => {
    const container = createRootContainer();
    expect(container.options.injectionMode).toBe(InjectionMode.PROXY);
  });

  it('is built with strict mode so a lifetime mismatch is refused, not silently pinned', () => {
    const container = createRootContainer();
    expect(container.options.strict).toBe(true);
  });

  it('fails immediately on an unknown name rather than resolving undefined', () => {
    const container = createRootContainer();
    expect(() => container.resolve('nothingIsRegisteredUnderThis')).toThrow(
      AwilixResolutionError,
    );
    expect(() => (container.cradle as Record<string, unknown>)['alsoUnknown']).toThrow(
      AwilixResolutionError,
    );
  });

  it('names the missing registration in the error, so a boot failure is diagnosable', () => {
    const container = createRootContainer();
    expect(() => container.resolve('pricingService')).toThrow(/pricingService/);
  });

  it('refuses a singleton that captures a scoped registration', () => {
    const container = createRootContainer();
    class PerRequest {}
    class ProcessWide {
      constructor(readonly cradle: { perRequest: PerRequest }) {
        void this.cradle.perRequest;
      }
    }
    container.register({
      perRequest: asClass(PerRequest).scoped(),
      processWide: asClass(ProcessWide).singleton(),
    });

    // Without strict mode this resolves and pins the first scope's instance for
    // the life of the process — the failure mode that would make the resolved
    // sales channel leak across tenants (Constitution XII) with no test to
    // catch it.
    const scope = container.createScope();
    expect(() => scope.resolve('processWide')).toThrow(/shorter lifetime/);
  });

  it('refuses to register a singleton on a scope', () => {
    const container = createRootContainer();
    const scope = container.createScope();
    expect(() => scope.register({ late: asClass(class Late {}).singleton() })).toThrow(
      /singleton on a scoped container/,
    );
  });

  it('runs disposers on dispose', async () => {
    const container = createRootContainer();
    const closed: string[] = [];
    container.register({
      redis: asClass(class Redis {})
        .singleton()
        .disposer(() => {
          closed.push('redis');
        }),
    });
    container.resolve('redis');
    await container.dispose();
    expect(closed).toEqual(['redis']);
  });

  it('installs and detaches process-shutdown disposal without leaking listeners', () => {
    const container = createRootContainer();
    const before = process.listenerCount('SIGTERM');
    const detach = installShutdownDisposal(container, ['SIGTERM']);
    expect(process.listenerCount('SIGTERM')).toBe(before + 1);
    detach();
    expect(process.listenerCount('SIGTERM')).toBe(before);
  });
});

describe('kernel ORM registrations', () => {
  it('resolves `em` transiently — a fresh fork per resolution (research R-1b)', () => {
    const container = createRootContainer();
    registerOrm(container, fakeOrm());
    expect(container.resolve('em')).not.toBe(container.resolve('em'));
  });

  it('keeps `emFactory` the closure module factories take, forking on every call', () => {
    const container = createRootContainer();
    registerOrm(container, fakeOrm());
    const emFactory = container.resolve<() => unknown>('emFactory');
    expect(emFactory()).not.toBe(emFactory());
  });
});
