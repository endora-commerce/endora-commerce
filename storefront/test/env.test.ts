import { describe, it, expect } from 'vitest';

import {
  BACKEND_BASE_URL_VAR,
  PUBLIC_API_BASE_URL_VAR,
  absoluteHttpUrlProblem,
  environmentRefusal,
  requireAbsoluteHttpUrl,
} from '../lib/env.mjs';

/**
 * The storefront's environment seam.
 *
 * Every assertion here is about a **refusal**. Until this landed, twelve reads
 * of `NEXT_PUBLIC_API_BASE_URL` and eleven of `BACKEND_BASE_URL` answered an
 * unset variable with `http://localhost:3001`, and the first of those is a
 * *browser* value that Next bakes into the bundle at build time — so a
 * storefront built without it shipped a bundle pointing every visitor at their
 * own machine, and the build reported success.
 */
describe('absoluteHttpUrlProblem', () => {
  it('accepts an absolute http and https origin', () => {
    expect(absoluteHttpUrlProblem('http://localhost:3001')).toBeNull();
    expect(absoluteHttpUrlProblem('https://api.example.com')).toBeNull();
    expect(absoluteHttpUrlProblem('https://api.example.com/base')).toBeNull();
  });

  it('reports an unset variable as missing', () => {
    expect(absoluteHttpUrlProblem(undefined)).toBe('missing');
  });

  it('reports an empty or blank value as missing, not as a bad URL', () => {
    // A `NEXT_PUBLIC_API_BASE_URL=` line and an absent one are the same state
    // for the operator, and "set it" is the same remedy.
    expect(absoluteHttpUrlProblem('')).toBe('missing');
    expect(absoluteHttpUrlProblem('   ')).toBe('missing');
  });

  it('reports a value that is not an absolute http(s) URL', () => {
    // `https://` is what `--build-arg NEXT_PUBLIC_API_BASE_URL="https://${API_DOMAIN}"`
    // produces when `API_DOMAIN` is unset: non-empty, and useless.
    expect(absoluteHttpUrlProblem('https://')).toBe('not-an-absolute-http-url');
    expect(absoluteHttpUrlProblem('api.example.com')).toBe('not-an-absolute-http-url');
    expect(absoluteHttpUrlProblem('/api/v1')).toBe('not-an-absolute-http-url');
    expect(absoluteHttpUrlProblem('ftp://api.example.com')).toBe('not-an-absolute-http-url');
  });
});

describe('environmentRefusal', () => {
  it('names the variable and what to set it to', () => {
    const message = environmentRefusal(PUBLIC_API_BASE_URL_VAR, 'missing', undefined);
    expect(message).toContain(PUBLIC_API_BASE_URL_VAR);
    expect(message).toContain('is not set');
    expect(message).toContain('storefront/.env.example');
  });

  it('quotes the value it rejected, so an operator can see what was read', () => {
    const message = environmentRefusal(BACKEND_BASE_URL_VAR, 'not-an-absolute-http-url', 'https://');
    expect(message).toContain(BACKEND_BASE_URL_VAR);
    expect(message).toContain('https://');
  });

  it('says when each variable is read, because the two remedies differ', () => {
    // The public one is inlined at build time and cannot be supplied later; the
    // server one is read by the process that serves the storefront.
    expect(environmentRefusal(PUBLIC_API_BASE_URL_VAR, 'missing', undefined)).toContain('build');
    expect(environmentRefusal(BACKEND_BASE_URL_VAR, 'missing', undefined)).toContain('run time');
  });
});

describe('requireAbsoluteHttpUrl', () => {
  it('returns the configured value unchanged', () => {
    expect(requireAbsoluteHttpUrl(BACKEND_BASE_URL_VAR, 'https://api.example.com')).toBe(
      'https://api.example.com',
    );
  });

  it('throws the refusal rather than inventing a default', () => {
    expect(() => requireAbsoluteHttpUrl(BACKEND_BASE_URL_VAR, undefined)).toThrow(
      /BACKEND_BASE_URL is not set/,
    );
    // The whole point: no answer anywhere is `http://localhost:3001`.
    expect(() => requireAbsoluteHttpUrl(BACKEND_BASE_URL_VAR, undefined)).toThrow(
      /^(?!.*localhost:3001 is the answer)/s,
    );
  });

  it('throws for a value that is not an absolute http(s) URL', () => {
    expect(() => requireAbsoluteHttpUrl(PUBLIC_API_BASE_URL_VAR, 'https://')).toThrow(
      /NEXT_PUBLIC_API_BASE_URL/,
    );
  });
});

describe('instrumentation register()', () => {
  /**
   * The runtime gate. `BACKEND_BASE_URL` is read by the process that serves the
   * storefront, so its refusal cannot live in `next.config.ts` — a standalone
   * build never evaluates that file again. `register()` is the earliest point in
   * the serving process, which is what keeps *unconfigured* from arriving at the
   * middleware as *unreachable*: the two are different failures, and only the
   * second is temporary.
   */
  async function runRegister(
    env: Record<string, string | undefined>,
  ): Promise<{ exited: number | null; written: string }> {
    const { register } = await import('../instrumentation');
    const previous = { ...process.env };
    let exited: number | null = null;
    let written = '';
    const realExit = process.exit;
    const realWrite = process.stderr.write.bind(process.stderr);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process as any).exit = (code?: number) => {
      exited = code ?? 0;
      throw new Error('__exit__');
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stderr as any).write = (chunk: string) => {
      written += chunk;
      return true;
    };
    try {
      for (const [key, value] of Object.entries(env)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      try {
        register();
      } catch (error) {
        if ((error as Error).message !== '__exit__') throw error;
      }
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process as any).exit = realExit;
      process.stderr.write = realWrite;
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, previous);
    }
    return { exited, written };
  }

  it('refuses a serving process with no BACKEND_BASE_URL, naming the variable', async () => {
    const { exited, written } = await runRegister({
      NEXT_RUNTIME: 'nodejs',
      BACKEND_BASE_URL: undefined,
    });
    expect(exited).toBe(1);
    expect(written).toContain('BACKEND_BASE_URL is not set');
    expect(written).toContain('cp storefront/.env.example storefront/.env');
  });

  it('refuses a BACKEND_BASE_URL that is not an absolute http(s) URL', async () => {
    const { exited, written } = await runRegister({
      NEXT_RUNTIME: 'nodejs',
      BACKEND_BASE_URL: 'backend:3001',
    });
    expect(exited).toBe(1);
    expect(written).toContain('BACKEND_BASE_URL');
  });

  it('lets a configured process start', async () => {
    const { exited, written } = await runRegister({
      NEXT_RUNTIME: 'nodejs',
      BACKEND_BASE_URL: 'http://backend:3001',
    });
    expect(exited).toBeNull();
    expect(written).toBe('');
  });

  it('says nothing in a runtime that has no process.exit', async () => {
    // `register()` is compiled for every instrumented runtime; the edge one has
    // no `process.exit`. The node server hosts the edge middleware, so asking
    // once in the node runtime covers both.
    const { exited, written } = await runRegister({
      NEXT_RUNTIME: 'edge',
      BACKEND_BASE_URL: undefined,
    });
    expect(exited).toBeNull();
    expect(written).toBe('');
  });
});
