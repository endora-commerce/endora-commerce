/**
 * "Which directories does this repository declare as its own packages?" — one
 * derivation, for every consumer of the answer (feature 080, T040a).
 *
 * It lives under `backend/scripts/lib/` rather than at the repository root, and
 * that is a runtime constraint rather than a taste: the root `package.json`
 * declares no `"type": "module"`, so `tsx` loads a root `scripts/*.ts` as
 * CommonJS and a named import of it from `backend/` — which *is* ESM — fails at
 * instantiation. `scripts/workspace-resolution.ts` reaches it from above
 * instead, where vite transforms it and the direction costs nothing.
 *
 * Three places need it and, before this file, two of them had their own copy
 * and the third had a guess:
 *
 *   * `backend/scripts/check-overlay-determinism.ts` expands the
 *     `pnpm-workspace.yaml` globs to decide whether a rendered entry lands in a
 *     workspace member or under an installed package (T030a). That is where the
 *     expansion below comes from, verbatim.
 *   * `scripts/workspace-resolution.ts` — the issue #255 guard — asked
 *     `readdir('packages')` instead, which is the same question answered one
 *     level deep. A package under `packages/<group>/<name>` is invisible to it,
 *     and invisible means **unguarded**: its `node_modules` link can point at
 *     another checkout and the run compiles somebody else's branch while
 *     reporting nothing.
 *   * `backend/scripts/lib/module-roots.ts` needs the same list to find the
 *     module roots that are packages rather than directories of the
 *     application.
 *
 * The workspace file is the authority, deliberately, and `node_modules` is not:
 * a member that is declared and not installed is still a member — the tree is
 * committed, and what it contains is a fact about the tree rather than about
 * whether somebody has run `pnpm install`. It is also the only authority that
 * *moves with the layout*: writing `packages/modules` into a check would be a
 * derived fact written down, which is what D-100 forbids and what feature 080
 * has had to repair three times.
 *
 * ## What it cannot see, stated rather than discovered later
 *
 *   * **A flow-style `pnpm-workspace.yaml`** (`packages: [a, b]`). The reader
 *     below is a block-sequence reader; a flow list produces **no** globs, and
 *     every caller treats "no glob" as a refusal rather than as an empty
 *     workspace. That is the same call `check-overlay-determinism` makes, for
 *     the same reason: a silently empty member list turns a containment test
 *     into a vacuous pass.
 *   * **A package vendored by hand into a workspace directory.** It reads as a
 *     member, because the globs are the authority.
 *   * **`pnpm-workspace.yaml` fields other than `packages:`.** pnpm has grown
 *     several; none of them changes which directories are members.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The two filesystem questions this derivation asks.
 *
 * Injected so a red proof can hand in a whole synthetic checkout at the top of
 * the analysis rather than a half-classified record at the bottom of it
 * (issue #130). `scripts/workspace-resolution.ts` already owns an injected
 * filesystem for exactly that reason and adapts it onto this one.
 */
export interface WorkspaceFs {
  /** File contents, or `null` when the file is absent or unreadable. */
  readonly readText: (path: string) => string | null;
  /** Immediate subdirectory names, or `[]` when the directory is absent. */
  readonly listDirectories: (path: string) => readonly string[];
}

/** One package this repository owns, as `pnpm-workspace.yaml` globs it. */
export interface WorkspaceMember {
  /** Absolute directory. */
  readonly dir: string;
  /** The `name` its `package.json` declares. */
  readonly name: string;
  /** The parsed manifest, so a caller can read its own fields off it. */
  readonly manifest: Readonly<Record<string, unknown>>;
}

/** The real filesystem behind {@link WorkspaceFs}. Absence is `null`/`[]`, never a throw. */
export function nodeWorkspaceFs(): WorkspaceFs {
  return {
    readText(path: string): string | null {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    listDirectories(path: string): readonly string[] {
      try {
        return readdirSync(path).filter((name) => {
          try {
            return statSync(join(path, name)).isDirectory();
          } catch {
            return false;
          }
        });
      } catch {
        return [];
      }
    },
  };
}

/** The `packages:` list of `pnpm-workspace.yaml`, as written. */
export function workspaceGlobs(repoRoot: string, fs: WorkspaceFs): readonly string[] {
  const source = fs.readText(join(repoRoot, 'pnpm-workspace.yaml'));
  if (source === null) return [];
  const globs: string[] = [];
  let inList = false;
  for (const raw of source.split('\n')) {
    const line = raw.replace(/#.*$/, '').trimEnd();
    if (/^packages:\s*$/.test(line)) {
      inList = true;
      continue;
    }
    if (!inList) continue;
    const item = /^\s+-\s*(.+)$/.exec(line);
    if (item === null) {
      if (line.trim() === '') continue;
      break;
    }
    globs.push(item[1]!.trim().replace(/^['"]|['"]$/g, ''));
  }
  return globs;
}

function childDirectories(dir: string, fs: WorkspaceFs): readonly string[] {
  return fs.listDirectories(dir).filter((name) => name !== 'node_modules' && !name.startsWith('.'));
}

function directoriesUnder(dir: string, fs: WorkspaceFs, out: string[] = []): string[] {
  for (const name of childDirectories(dir, fs)) {
    const full = join(dir, name);
    out.push(full);
    directoriesUnder(full, fs, out);
  }
  return out;
}

/** Directories a workspace glob matches, `*` per segment and `**` any depth. */
export function expandWorkspaceGlob(
  repoRoot: string,
  glob: string,
  fs: WorkspaceFs,
): readonly string[] {
  const segments = glob.split('/').filter((segment) => segment.length > 0);
  let cursor = [repoRoot];
  for (const segment of segments) {
    const next: string[] = [];
    for (const dir of cursor) {
      if (segment === '**') {
        next.push(dir, ...directoriesUnder(dir, fs));
        continue;
      }
      for (const name of childDirectories(dir, fs)) {
        if (segment === '*' || segment === name) next.push(join(dir, name));
      }
    }
    cursor = next;
  }
  return cursor;
}

/**
 * Every directory the workspace globs match and that carries a `package.json`.
 *
 * Sorted, deduplicated, absolute. A glob that matches a directory without a
 * manifest is not an error — `packages/modules` will match `packages/*` while
 * being nothing but the parent of the members — it simply is not a member.
 */
export function workspaceMemberDirectories(
  repoRoot: string,
  fs: WorkspaceFs,
): readonly string[] {
  const globs = workspaceGlobs(repoRoot, fs);
  const excluded = new Set(
    globs
      .filter((glob) => glob.startsWith('!'))
      .flatMap((glob) => expandWorkspaceGlob(repoRoot, glob.slice(1), fs)),
  );
  const found = new Set<string>();
  for (const glob of globs.filter((candidate) => !candidate.startsWith('!'))) {
    for (const dir of expandWorkspaceGlob(repoRoot, glob, fs)) {
      if (excluded.has(dir)) continue;
      if (fs.readText(join(dir, 'package.json')) === null) continue;
      found.add(dir);
    }
  }
  return [...found].sort();
}

/** Every workspace member whose manifest declares a `name`, sorted by directory. */
export function workspaceMembers(repoRoot: string, fs: WorkspaceFs): readonly WorkspaceMember[] {
  const members: WorkspaceMember[] = [];
  for (const dir of workspaceMemberDirectories(repoRoot, fs)) {
    const text = fs.readText(join(dir, 'package.json'));
    if (text === null) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
    const manifest = parsed as Record<string, unknown>;
    const name = manifest['name'];
    if (typeof name !== 'string' || name.length === 0) continue;
    members.push({ dir, name, manifest });
  }
  return members;
}

/**
 * The npm scopes those members are published under, sorted, each with its
 * trailing slash — `['@b2b/']` today.
 *
 * Derived rather than declared, because a second scope is exactly what feature
 * 080 introduces and the one thing that must not happen is a guard that keeps
 * answering about the first one. An unscoped member (`backend`, `admin`,
 * `docs`) contributes no scope: nothing resolves it by specifier, so there is
 * no link for a guard to classify.
 */
export function workspaceScopes(members: readonly WorkspaceMember[]): readonly string[] {
  const scopes = new Set<string>();
  for (const member of members) {
    const cut = member.name.indexOf('/');
    if (member.name.startsWith('@') && cut > 0) scopes.add(`${member.name.slice(0, cut)}/`);
  }
  return [...scopes].sort();
}
