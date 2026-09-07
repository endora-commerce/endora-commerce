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
 * A workspace member, plus which workspace entries produced it.
 *
 * The classification is one sentence and it is the workspace file's own: **an
 * entry containing a glob character enumerates a library *family* — a set whose
 * membership is decided by what is on disk — and a literal entry names one
 * deployable.** Today that reads `packages/*` and `packages/modules/*` as the
 * family and `backend`, `storefront`, `admin`, `docs` as applications, which is
 * the split `AGENTS.md` states in prose, and it costs nothing when the family
 * grows: module packages a directory deeper arrive through a glob and are
 * family by construction.
 *
 * A member matched by both a literal and a glob counts as **family**, which is
 * the failing-safe direction for both readers: a family member is versionable
 * (it must carry a changeset) and it ships a `dist` (it must pass the
 * distribution gate). Being wrong that way asks for more, never less.
 */
export interface ClassifiedWorkspaceMember extends WorkspaceMember {
  /**
   * True when a *glob* workspace entry produced it — a library family. False
   * when every entry that produced it is a literal directory — an application.
   */
  readonly family: boolean;
  /** The workspace entries that matched it, for a message that can name one. */
  readonly globs: readonly string[];
}

/** Every member, classified, with what each workspace entry produced. */
export interface WorkspaceClassification {
  readonly members: readonly ClassifiedWorkspaceMember[];
  /** Non-negated workspace entries, and how many members each produced. */
  readonly globCoverage: ReadonlyMap<string, number>;
}

/**
 * {@link workspaceMembers}, with the family/application split its callers used
 * to derive for themselves.
 *
 * Two readers need it and they are asking the same question at two distances:
 * `check-release-intent.ts` asks *"must a change here carry a changeset?"* and
 * `test/unit/packages/package-dist-build.test.ts` asks *"must this package ship
 * a compiled `dist` a stranger can consume?"* Both are *"is this a library we
 * publish or an application we deploy?"*, and a second answer to it is two
 * answers waiting to disagree.
 */
export function classifyWorkspaceMembers(
  repoRoot: string,
  fs: WorkspaceFs,
): WorkspaceClassification {
  const globs = workspaceGlobs(repoRoot, fs).filter((glob) => !glob.startsWith('!'));
  const members = workspaceMembers(repoRoot, fs);
  const globCoverage = new Map<string, number>();
  const matchedGlobs = new Map<string, string[]>();
  for (const glob of globs) {
    const dirs = new Set(expandWorkspaceGlob(repoRoot, glob, fs));
    let covered = 0;
    for (const member of members) {
      if (!dirs.has(member.dir)) continue;
      covered += 1;
      const list = matchedGlobs.get(member.dir) ?? [];
      list.push(glob);
      matchedGlobs.set(member.dir, list);
    }
    globCoverage.set(glob, covered);
  }
  return {
    members: members.map((member) => {
      const own = matchedGlobs.get(member.dir) ?? [];
      return { ...member, family: own.some((glob) => glob.includes('*')), globs: own };
    }),
    globCoverage,
  };
}

/**
 * The npm scopes those members are published under, sorted, each with its
 * trailing slash — `['@endora-commerce/']` today.
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

/** A workspace member that declares itself a backend module. */
export interface ModulePackage {
  /** Absolute directory of the member. */
  readonly dir: string;
  /** The npm name it publishes under. */
  readonly name: string;
  /** The manifest id it declares — identity of record everywhere (D-142). */
  readonly moduleId: string;
}

/**
 * The module id a member declares about itself, or `null`.
 *
 * The `endora` block is the package's own statement, the same one
 * `src/packages/installed-packages.ts` reads at boot, so a module package is
 * recognised wherever the workspace globs put it and whatever its directory is
 * called. Nothing here reads the npm name's spelling — a `mod-` prefix rule
 * would be a derived fact written down (D-100).
 */
export function declaredModuleId(member: WorkspaceMember): string | null {
  const endora = member.manifest['endora'];
  if (typeof endora !== 'object' || endora === null || Array.isArray(endora)) return null;
  const block = endora as Record<string, unknown>;
  if (block['type'] !== 'module') return null;
  const id = block['id'];
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Every workspace member that declares itself a module, sorted by directory.
 *
 * Unfiltered by the manifest index on purpose, which is the one difference from
 * `lib/module-roots.ts`'s package half: that derivation is answering "which
 * *registered* modules live in a package", and a consumer outside the backend —
 * the Tailwind source guard in `scripts/tailwind-source-scan.ts` — is answering
 * "which packages can ship UI". A package that ships a screen before its
 * manifest reaches the generated index still ships the screen.
 */
export function modulePackages(members: readonly WorkspaceMember[]): readonly ModulePackage[] {
  const packages: ModulePackage[] = [];
  for (const member of members) {
    const moduleId = declaredModuleId(member);
    if (moduleId === null) continue;
    packages.push({ dir: member.dir, name: member.name, moduleId });
  }
  return packages.sort((left, right) => left.dir.localeCompare(right.dir));
}

/** A workspace member that declares itself a package of admin UI. */
export interface AdminUiPackage {
  /** Absolute directory of the member. */
  readonly dir: string;
  /** The npm name it publishes under. */
  readonly name: string;
}

/**
 * Does a member declare itself a package whose sources are **admin UI**?
 *
 * The third value of the `endora.type` block, beside `'platform'` (the host)
 * and `'module'` (a module package), and read the same way: the package's own
 * statement about itself, over the members `pnpm-workspace.yaml` globs. Nothing
 * here reads a directory or a name — `packages/admin-kit` and
 * `@endora-commerce/admin-kit` appear in no predicate, which is what lets a
 * second admin-ui package arrive under any name and be judged from its first
 * commit (feature 091, P5c).
 *
 * ## Why this is not D-171's refused self-certification
 *
 * D-171 refused an `endora`-block field that would have **exempted** a package
 * from `check:module-boundary`'s ledger: an exemption from a rule, issued by
 * the party the rule measures. This declaration is the opposite direction. It
 * puts the package *into* two populations — `i18n:hardcoded`'s walk and
 * `check:admin-zones`' third `foreign-module-id` population — so declaring it
 * buys obligations and nothing else, and the only thing an author gains by
 * omitting it is that their hard-coded strings and their foreign module ids go
 * unread.
 *
 * Forgetting it therefore has to fail loudly, and it does: `i18n:hardcoded`'s
 * baseline is keyed by path and two-way, so a file that arrives in an
 * undeclared package is a ledger entry naming a path the walk never opened —
 * `drained`, exit 1 — in the same run. That is the property that makes a
 * declaration safe here and an exemption unsafe there.
 */
export function declaresAdminUi(member: WorkspaceMember): boolean {
  const endora = member.manifest['endora'];
  if (typeof endora !== 'object' || endora === null || Array.isArray(endora)) return false;
  return (endora as Record<string, unknown>)['type'] === 'admin-ui';
}

/**
 * Every workspace member that declares itself admin UI, sorted by directory.
 *
 * The shape {@link modulePackages} has, for the same reason: one derivation of
 * "which packages ship admin code", so the two instruments that walk them
 * cannot come to disagree about the population.
 */
export function adminUiPackages(
  members: readonly WorkspaceMember[],
): readonly AdminUiPackage[] {
  return members
    .filter((member) => declaresAdminUi(member))
    .map((member) => ({ dir: member.dir, name: member.name }))
    .sort((left, right) => left.dir.localeCompare(right.dir));
}

/**
 * Is this manifest a Next application — the shape the reference storefront has?
 *
 * A member qualifies by declaring `next` as a dependency **and** a `build`
 * script that runs it. Both halves are needed: a package that merely depends on
 * `next` may be a component library that peers on it, and a `build` script
 * naming `next build` in a manifest that does not depend on `next` is a
 * misconfiguration rather than an application.
 *
 * It lives here, beside the derivation of *which directories are members*,
 * because two consumers ask the same question of the same population and a
 * second copy of the predicate is two answers waiting to disagree about which
 * application they are talking about: `new-storefront/reference.ts` resolves the
 * storefront it copies, and `check-release-intent.ts` resolves the one whose
 * dependency closure is the publication set (feature 104, FR-001).
 */
export function isNextApplication(manifest: Readonly<Record<string, unknown>>): boolean {
  const dependencies = manifest['dependencies'];
  const scripts = manifest['scripts'];
  const declaresNext =
    typeof dependencies === 'object' && dependencies !== null && 'next' in dependencies;
  const build =
    typeof scripts === 'object' && scripts !== null
      ? (scripts as Record<string, unknown>)['build']
      : undefined;
  return declaresNext && typeof build === 'string' && /\bnext build\b/.test(build);
}
