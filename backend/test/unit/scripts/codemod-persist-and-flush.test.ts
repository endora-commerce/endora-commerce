import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

import {
  collectFiles,
  rewriteSource,
  runCodemod,
} from '../../../scripts/codemods/persist-and-flush.js';

/**
 * Companion test for the `persistAndFlush` / `removeAndFlush` codemod (issue #1863).
 *
 * MikroORM 7 removes both methods. The codemod rewrites every call site to the
 * chain MikroORM 6 already implements them as (`persist(x).flush()`), and the
 * test doubles that stood in for them to doubles that answer that chain. The
 * shapes below are the ones the tree holds; the refusals are the shapes a
 * mechanical rewrite cannot get right, which the run lists for a hand edit
 * instead of guessing.
 */

const SCRIPT = fileURLToPath(
  new URL('../../../scripts/codemods/persist-and-flush.ts', import.meta.url),
);

const rewrite = (source: string, fileName = 'subject.ts') => rewriteSource(source, fileName);

/** Transpile and run `source` (an async function body) in a sandbox; return its `log`. */
async function evaluate(source: string): Promise<unknown[]> {
  const js = ts.transpileModule(`(async () => { const log = []; ${source}\n return log; })()`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const fn = (impl?: (...args: unknown[]) => unknown) => {
    const calls: unknown[][] = [];
    const mock = (...args: unknown[]) => {
      calls.push(args);
      return impl?.(...args);
    };
    return Object.assign(mock, { mock: { calls } });
  };
  return (await runInNewContext(js, { vi: { fn } })) as unknown[];
}

describe('call sites', () => {
  it('rewrites an awaited persistAndFlush and removeAndFlush, keeping the await', () => {
    const out = rewrite(
      'async function f(em: Em, a: A) {\n' +
        '  await em.persistAndFlush(a);\n' +
        '  await em.removeAndFlush(a);\n' +
        '}\n',
    );
    expect(out.text).toBe(
      'async function f(em: Em, a: A) {\n' +
        '  await em.persist(a).flush();\n' +
        '  await em.remove(a).flush();\n' +
        '}\n',
    );
    expect(out.rewritten).toBe(2);
    expect(out.manual).toEqual([]);
  });

  it('keeps an array argument, type arguments and a multi-line argument list as written', () => {
    const out = rewrite(
      'await em.persistAndFlush([a, b]);\n' +
        'await em.persistAndFlush<Row>(row);\n' +
        'await em.persistAndFlush(\n' +
        '  em.create(Row, { id: 1 }),\n' +
        ');\n',
    );
    expect(out.text).toBe(
      'await em.persist([a, b]).flush();\n' +
        'await em.persist<Row>(row).flush();\n' +
        'await em.persist(\n' +
        '  em.create(Row, { id: 1 }),\n' +
        ').flush();\n',
    );
  });

  it('rewrites on any receiver: chained, forked, awaited, aliased, optional', () => {
    const out = rewrite(
      'await this.orm.em.fork().persistAndFlush(a);\n' +
        'await (await h.em()).removeAndFlush(a);\n' +
        'const tx = em;\n' +
        'await tx.persistAndFlush(a);\n' +
        'await this.em?.persistAndFlush(a);\n',
    );
    expect(out.text).toBe(
      'await this.orm.em.fork().persist(a).flush();\n' +
        'await (await h.em()).remove(a).flush();\n' +
        'const tx = em;\n' +
        'await tx.persist(a).flush();\n' +
        'await this.em?.persist(a).flush();\n',
    );
    expect(out.manual).toEqual([]);
  });

  it('rewrites a call that is returned or nested inside another call', () => {
    const out = rewrite(
      'const save = (r: R) => em.persistAndFlush(r);\n' +
        'await Promise.all(rows.map((r) => em.persistAndFlush(r)));\n' +
        'await em.persistAndFlush(await other.persistAndFlush(a));\n',
    );
    expect(out.text).toBe(
      'const save = (r: R) => em.persist(r).flush();\n' +
        'await Promise.all(rows.map((r) => em.persist(r).flush()));\n' +
        'await em.persist(await other.persist(a).flush()).flush();\n',
    );
  });

  it('touches neither comments nor string data', () => {
    const source =
      '// em.persistAndFlush(a) used to be here\n' +
      "const kinds = new Set(['remove', 'removeAndFlush']);\n" +
      "ops.push({ kind: 'persistAndFlush' });\n";
    const out = rewrite(source);
    expect(out.text).toBe(source);
    expect(out.rewritten).toBe(0);
    expect(out.manual).toEqual([]);
  });

  it('returns a file that never names either method untouched', () => {
    const source = 'await em.persist(a).flush();\n';
    expect(rewrite(source)).toEqual({ text: source, rewritten: 0, manual: [] });
  });

  it('is idempotent: its own output rewrites to itself', () => {
    const first = rewrite(
      'const em = {\n' +
        '  persistAndFlush: async (row: Row) => {\n' +
        '    rows.push(row);\n' +
        '  },\n' +
        '};\n' +
        'await em.persistAndFlush(a);\n',
    );
    const second = rewrite(first.text);
    expect(second.text).toBe(first.text);
    expect(second.rewritten).toBe(0);
  });

  it('parses .tsx', () => {
    const out = rewrite('const x = <A onClick={() => em.persistAndFlush(a)} />;\n', 'view.tsx');
    expect(out.text).toBe('const x = <A onClick={() => em.persist(a).flush()} />;\n');
  });
});

describe('test doubles', () => {
  it('turns a one-line arrow double into persist() returning a flush that does the same', () => {
    const out = rewrite(
      'const em = { create, persistAndFlush: async () => undefined, flush: async () => {} };\n',
    );
    expect(out.text).toBe(
      'const em = { create, persist: () => ({ flush: async () => undefined }), flush: async () => {} };\n',
    );
    expect(out.rewritten).toBe(1);
  });

  it('keeps the parameters, the body and its indentation of a multi-line arrow double', () => {
    const out = rewrite(
      'const em = {\n' +
        '  persistAndFlush: async (row: Row): Promise<void> => {\n' +
        '    rows.push(row);\n' +
        '  },\n' +
        '  removeAndFlush: async (row) => {\n' +
        '    rows.splice(rows.indexOf(row), 1);\n' +
        '  },\n' +
        '};\n',
    );
    expect(out.text).toBe(
      'const em = {\n' +
        '  persist: (row: Row) => ({\n' +
        '    flush: async (): Promise<void> => {\n' +
        '      rows.push(row);\n' +
        '    },\n' +
        '  }),\n' +
        '  remove: (row) => ({\n' +
        '    flush: async () => {\n' +
        '      rows.splice(rows.indexOf(row), 1);\n' +
        '    },\n' +
        '  }),\n' +
        '};\n',
    );
    expect(out.manual).toEqual([]);
  });

  it('wraps a vi.fn double and retargets the assertions that read it', () => {
    const out = rewrite(
      'const h = { em: { persistAndFlush: vi.fn(async () => undefined) } };\n' +
        'const bare = { persistAndFlush: vi.fn() };\n' +
        'expect(h.em.persistAndFlush).toHaveBeenCalledTimes(1);\n' +
        'const first = bare.persistAndFlush.mock.calls[0]![0];\n',
    );
    expect(out.text).toBe(
      'const h = { em: { persist: vi.fn(() => ({ flush: async () => undefined })) } };\n' +
        'const bare = { persist: vi.fn(() => ({ flush: async () => undefined })) };\n' +
        'expect(h.em.persist).toHaveBeenCalledTimes(1);\n' +
        'const first = bare.persist.mock.calls[0]![0];\n',
    );
    expect(out.manual).toEqual([]);
  });

  it('turns a method double, in an object literal and in a class, into persist() returning flush', () => {
    const out = rewrite(
      'class FakeEm {\n' +
        '  rows: Row[] = [];\n' +
        '  async persistAndFlush(row: Row): Promise<void> {\n' +
        '    this.rows.push(row);\n' +
        '  }\n' +
        '}\n' +
        'const em = {\n' +
        '  async removeAndFlush(): Promise<void> {},\n' +
        '};\n',
    );
    expect(out.text).toBe(
      'class FakeEm {\n' +
        '  rows: Row[] = [];\n' +
        '  persist(row: Row) {\n' +
        '    return {\n' +
        '      flush: async (): Promise<void> => {\n' +
        '        this.rows.push(row);\n' +
        '      },\n' +
        '    };\n' +
        '  }\n' +
        '}\n' +
        'const em = {\n' +
        '  remove() { return { flush: async (): Promise<void> => {} }; },\n' +
        '};\n',
    );
    expect(out.manual).toEqual([]);
  });

  it('replaces a persist that does nothing with the double, and drops the old name', () => {
    const out = rewrite(
      'const em = { persist: () => undefined, persistAndFlush: async () => undefined, flush: async () => undefined };\n' +
        'const last = { remove: () => {}, removeAndFlush: async () => {} };\n',
    );
    expect(out.text).toBe(
      'const em = { persist: () => ({ flush: async () => undefined }), flush: async () => undefined };\n' +
        'const last = { remove: () => ({ flush: async () => {} }) };\n',
    );
    expect(out.manual).toEqual([]);
  });

  it('merges a multi-line method double into an empty persist() written after it', () => {
    const out = rewrite(
      'const em = {\n' +
        '  create(): Row {\n' +
        '    return row;\n' +
        '  },\n' +
        '  async persistAndFlush(entity: Row): Promise<void> {\n' +
        '    flushed.push(entity);\n' +
        '  },\n' +
        '  persist(): void {},\n' +
        '};\n',
    );
    expect(out.text).toBe(
      'const em = {\n' +
        '  create(): Row {\n' +
        '    return row;\n' +
        '  },\n' +
        '  persist(entity: Row) {\n' +
        '    return {\n' +
        '      flush: async (): Promise<void> => {\n' +
        '        flushed.push(entity);\n' +
        '      },\n' +
        '    };\n' +
        '  },\n' +
        '};\n',
    );
  });

  it('behaves identically after a merge: a bare persist still does nothing', async () => {
    const before =
      'const em = {\n' +
      '  persist: () => undefined,\n' +
      '  persistAndFlush: async (row) => { log.push(["saved", row]); },\n' +
      '  flush: async () => { log.push(["em.flush"]); },\n' +
      '};\n' +
      'em.persist(0);\n' +
      'await em.flush();\n' +
      'await em.persistAndFlush(1);\n';
    const after = rewrite(before);
    expect(after.text).not.toMatch(/AndFlush/);
    expect(await evaluate(after.text)).toEqual(await evaluate(before));
  });

  it('renames a type member that types a vi.fn double', () => {
    const out = rewrite(
      'interface H { persistAndFlush: ReturnType<typeof vi.fn> }\n' +
        'const h = { persistAndFlush: vi.fn() };\n',
    );
    expect(out.text).toBe(
      'interface H { persist: ReturnType<typeof vi.fn> }\n' +
        'const h = { persist: vi.fn(() => ({ flush: async () => undefined })) };\n',
    );
  });

  it('rewrites call sites inside a double it rewrites', () => {
    const out = rewrite(
      'const em = {\n' +
        '  persistAndFlush: async (row: Row) => {\n' +
        '    await inner.persistAndFlush(row);\n' +
        '  },\n' +
        '};\n',
    );
    expect(out.text).toBe(
      'const em = {\n' +
        '  persist: (row: Row) => ({\n' +
        '    flush: async () => {\n' +
        '      await inner.persist(row).flush();\n' +
        '    },\n' +
        '  }),\n' +
        '};\n',
    );
  });

  it('does not re-indent a multi-line template literal inside a double', () => {
    const out = rewrite(
      'const em = {\n' +
        '  persistAndFlush: async () => {\n' +
        '    log(`a\n' +
        'b`);\n' +
        '  },\n' +
        '};\n',
    );
    expect(out.text).toContain('log(`a\nb`);');
    expect(out.manual).toEqual([]);
  });

  it('behaves identically: the rewritten double records the same thing for the rewritten call', async () => {
    const before =
      'const em = {\n' +
      '  persistAndFlush: async (row) => {\n' +
      '    log.push(["persisted", row]);\n' +
      '  },\n' +
      '  removeAndFlush: vi.fn(async (row) => { log.push(["removed", row]); }),\n' +
      '  async flush() { log.push(["em.flush"]); },\n' +
      '};\n' +
      'await em.persistAndFlush(1);\n' +
      'await em.removeAndFlush([2, 3]);\n' +
      'log.push(["calls", em.removeAndFlush.mock.calls.length]);\n';
    const after = rewrite(before);
    expect(after.manual).toEqual([]);
    expect(after.text).not.toMatch(/AndFlush/);
    expect(await evaluate(after.text)).toEqual(await evaluate(before));
  });

  it('behaves identically against a manager whose persist() returns itself', async () => {
    const before =
      'const em = {\n' +
      '  persist(x) { log.push(["persist", x]); return this; },\n' +
      '  remove(x) { log.push(["remove", x]); return this; },\n' +
      '  async flush() { log.push(["flush"]); },\n' +
      '  async persistAndFlush(x) { await this.persist(x).flush(); },\n' +
      '  async removeAndFlush(x) { await this.remove(x).flush(); },\n' +
      '};\n';
    const calls = 'await em.persistAndFlush([1, 2]);\nawait em.removeAndFlush(3);\n';
    const rewritten = rewrite(calls).text;
    expect(rewritten).toBe('await em.persist([1, 2]).flush();\nawait em.remove(3).flush();\n');
    expect(await evaluate(before + rewritten)).toEqual(await evaluate(before + calls));
  });
});

describe('what it leaves for a hand edit', () => {
  const reasonsOf = (source: string) => rewrite(source).manual.map((m) => m.reason);

  it('a double whose object already has persist / remove', () => {
    const out = rewrite(
      'const em = {\n' +
        '  persist: vi.fn(),\n' +
        '  flush: vi.fn(),\n' +
        '  persistAndFlush: vi.fn(),\n' +
        '};\n' +
        'expect(em.persistAndFlush).not.toHaveBeenCalled();\n',
    );
    expect(out.manual.map((m) => [m.line, m.reason])).toEqual([
      [4, expect.stringContaining('already has a `persist` that does something')],
      [6, expect.stringContaining('reference')],
    ]);
    expect(out.text).toContain('persistAndFlush: vi.fn()');
  });

  it('a class double that already has remove, or extends another class', () => {
    expect(
      reasonsOf(
        'class A { remove(x: X): void { this.rows.delete(x); } async removeAndFlush(x: X) { this.remove(x); } }\n' +
          'class B extends Base { async persistAndFlush() {} }\n',
      ),
    ).toEqual([
      expect.stringContaining('already has a `remove` that does something'),
      expect.stringContaining('extends'),
    ]);
  });

  it('an object double that spreads another object', () => {
    expect(reasonsOf('const em = { ...real, persistAndFlush: async () => {} };\n')).toEqual([
      expect.stringContaining('spread'),
    ]);
  });

  it('a double assigned onto an object, a shorthand property and a local of that name', () => {
    expect(
      reasonsOf(
        'fork.persistAndFlush = async (p) => {};\n' +
          'const persistAndFlush = vi.fn();\n' +
          'const em = { persistAndFlush };\n',
      ),
    ).toEqual([
      expect.stringContaining('assigned'),
      expect.stringContaining('declaration'),
      expect.stringContaining('shorthand'),
    ]);
  });

  it('a vi.fn double configured by a chained call or with type arguments', () => {
    expect(
      reasonsOf(
        'const a = { persistAndFlush: vi.fn().mockRejectedValue(new Error("x")) };\n' +
          'const b = { removeAndFlush: vi.fn<() => Promise<void>>() };\n',
      ),
    ).toEqual([expect.stringContaining('value'), expect.stringContaining('value')]);
  });

  it('a spy, an element access and an optional call', () => {
    expect(
      reasonsOf(
        "vi.spyOn(em, 'persistAndFlush');\n" +
          "await em['removeAndFlush'](a);\n" +
          'await em.persistAndFlush?.(a);\n',
      ),
    ).toEqual([
      expect.stringContaining('spy'),
      expect.stringContaining('element access'),
      expect.stringContaining('optional call'),
    ]);
  });

  it('a method reference taken as a value where the file defines no double', () => {
    const out = rewrite('const save = em.persistAndFlush.bind(em);\n');
    expect(out.manual).toEqual([
      { line: 1, column: 17, reason: expect.stringContaining('reference') },
    ]);
  });

  it('a function-expression double that reads `this`', () => {
    expect(
      reasonsOf('const em = { persistAndFlush: async function (x) { this.rows.push(x); } };\n'),
    ).toEqual([expect.stringContaining('value')]);
  });
});

describe('the run', () => {
  let root: string | undefined;
  afterEach(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  function fixture(files: Record<string, string>): string {
    root = mkdtempSync(join(tmpdir(), 'persist-and-flush-'));
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return root;
  }

  it('walks source files and skips dependencies, build output, hidden and nested checkouts', () => {
    const dir = fixture({
      'src/a.ts': '',
      'src/b.tsx': '',
      'src/c.mjs': '',
      'src/types.d.ts': '',
      'src/readme.md': '',
      'node_modules/x/index.ts': '',
      'dist/a.js': '',
      '.cache/a.ts': '',
      'nested/.git': 'gitdir: elsewhere',
      'nested/a.ts': '',
    });
    expect(collectFiles([dir]).map((f) => f.slice(dir.length + 1)).sort()).toEqual([
      'src/a.ts',
      'src/b.tsx',
      'src/c.mjs',
    ]);
  });

  it('writes the rewrite, reports what is left and exits 1 while something is', () => {
    const dir = fixture({
      'a.ts': 'await em.persistAndFlush(a);\n',
      'b.ts': 'fork.removeAndFlush = async () => {};\n',
      'c.ts': 'export const x = 1;\n',
    });
    const lines: string[] = [];
    const code = runCodemod({ paths: [dir], write: true, log: (l) => lines.push(l) });
    expect(code).toBe(1);
    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('await em.persist(a).flush();\n');
    expect(readFileSync(join(dir, 'b.ts'), 'utf8')).toBe('fork.removeAndFlush = async () => {};\n');
    expect(lines).toContain('[persist-and-flush] read: files=3 sites=2');
    expect(lines.some((l) => l.includes('b.ts:1:6'))).toBe(true);
  });

  it('writes nothing in --dry-run and exits 0 when nothing is left', () => {
    const dir = fixture({ 'a.ts': 'await em.removeAndFlush(a);\n' });
    const code = runCodemod({ paths: [dir], write: false, log: () => {} });
    expect(code).toBe(0);
    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('await em.removeAndFlush(a);\n');
  });

  it('exits 2 when it read nothing, rather than reporting a clean tree', () => {
    const dir = fixture({ 'readme.md': 'em.persistAndFlush(a)' });
    expect(runCodemod({ paths: [dir], write: true, log: () => {} })).toBe(2);
    expect(runCodemod({ paths: [join(dir, 'missing')], write: true, log: () => {} })).toBe(2);
  });

  it('runs under plain node, as an instance runs it, with no tsx', () => {
    const dir = fixture({ 'apps/demo/modules/x/service.ts': 'await em.persistAndFlush(a);\n' });
    const run = spawnSync(process.execPath, [SCRIPT, join(dir, 'apps')], { encoding: 'utf8' });
    expect(run.stderr).not.toMatch(/Error/);
    expect(run.status).toBe(0);
    expect(readFileSync(join(dir, 'apps/demo/modules/x/service.ts'), 'utf8')).toBe(
      'await em.persist(a).flush();\n',
    );
  });
});
