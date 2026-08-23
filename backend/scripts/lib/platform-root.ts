/**
 * "Where does the platform's source live?" — derived, never spelled (feature
 * 080, the platform relocation).
 *
 * The five platform directories — `kernel`, `http`, `tenancy`, `commands`,
 * `events` — moved out of `backend/src` and into `@endora-commerce/platform`,
 * so that the application and an installed extension package resolve **one**
 * copy of them. A dozen tools read that tree: `check:platform-surface`,
 * `check:kernel-boundary`, every check that walks
 * {@link ModuleTreeLayout.sourceRoots}, and the composer generator, whose entity
 * registry would otherwise lose `sales_channels`, `settings`, `audit_logs` and
 * `module_registrations`.
 *
 * Every one of them used to write `join(BACKEND_ROOT, 'src', 'kernel')`, which
 * is the shape `scripts/lib/module-root.sh` was written to end for the module
 * tree and for the same reason (feature 080, T012): a path written into a tool
 * is a derived fact recorded by hand (D-100), and a layout move takes the tool
 * with it — the walk iterates nothing, the check reports on what is left, and
 * the run prints a green tick. Issue #215 is that defect one directory over.
 *
 * ## The discriminator is a declaration, not a name
 *
 * The platform is the workspace member whose manifest declares
 * `"endora": { "type": "platform" }` — the same authored block `lib/module-roots.ts`
 * and `lib/module-packages.ts` already read to find a *module* package, and the
 * shape D-142 makes authoritative for a package's identity. Keying on the
 * package name would work until the scope rename D-161 is finished; keying on
 * `packages/platform/` would work until somebody moves it, which is the move
 * this file exists because of.
 *
 * Two members declaring it is an error rather than a first-one-wins, for the
 * reason `scripts/lib/module-root.sh` refuses two manifest indexes: the walk
 * would silently narrow to whichever sorted first.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  nodeWorkspaceFs,
  workspaceMembers,
  type WorkspaceFs,
  type WorkspaceMember,
} from './workspace-packages.js';

/** Raised when the platform cannot be located; a caller turns it into exit 2. */
export class PlatformRootUnresolvableError extends Error {
  override readonly name = 'PlatformRootUnresolvableError';
}

/** The `endora` block a member declares about itself, if it is the platform's. */
function declaresPlatform(member: WorkspaceMember): boolean {
  const endora = member.manifest['endora'];
  if (typeof endora !== 'object' || endora === null || Array.isArray(endora)) return false;
  return (endora as Record<string, unknown>)['type'] === 'platform';
}

/**
 * The platform's source directory among a set of workspace members, or `null`.
 *
 * `null` and not a throw, because the fixture workspaces the layout tests build
 * legitimately have no platform. A caller for which the platform *is* the
 * population — `check:platform-surface`, `check:kernel-boundary` — refuses on
 * `null` itself, which is the only place that refusal means anything.
 */
export function platformSourceRootOf(members: readonly WorkspaceMember[]): string | null {
  const declared = members.filter(declaresPlatform);
  if (declared.length === 0) return null;
  if (declared.length > 1) {
    throw new PlatformRootUnresolvableError(
      `${declared.length} workspace members declare \`endora.type: "platform"\` ` +
        `(${declared.map((member) => member.dir).join(', ')}). A walk would narrow to ` +
        'whichever sorted first and report on it as if it were the platform.',
    );
  }
  const root = join(declared[0]!.dir, 'src');
  if (!existsSync(root)) {
    throw new PlatformRootUnresolvableError(
      `${root} does not exist — ${declared[0]!.name} declares itself the platform and its ` +
        'sources are not there. A walk of it would come back empty, which is ' +
        'indistinguishable from a clean platform (issue #113).',
    );
  }
  return root;
}

/** The same, reading the workspace at `repoRoot`. */
export function platformSourceRootAt(
  repoRoot: string,
  fs: WorkspaceFs = nodeWorkspaceFs(),
): string | null {
  return platformSourceRootOf(workspaceMembers(repoRoot, fs));
}

/**
 * The subpaths the platform publishes, read off its own `exports` map.
 *
 * D-160.7 rules five enumerated subpaths, one per platform directory, and that
 * map is where the ruling is authored. Reading it is what
 * `lib/platform-surface.ts` said it would do "the day the host `package.json`
 * exists": it does now, and `backend` depends on it, so a sixth published
 * directory arrives in every walk at once instead of in whichever list somebody
 * remembers. `./package.json` is filtered out — it is an `exports` entry and not
 * a platform directory.
 */
export function platformSubpathsOf(members: readonly WorkspaceMember[]): readonly string[] {
  const declared = members.filter(declaresPlatform);
  if (declared.length !== 1) {
    throw new PlatformRootUnresolvableError(
      `${declared.length} workspace members declare \`endora.type: "platform"\` — the ` +
        'published subpaths are read off exactly one manifest',
    );
  }
  const exportsBlock = declared[0]!.manifest['exports'];
  const subpaths =
    typeof exportsBlock === 'object' && exportsBlock !== null && !Array.isArray(exportsBlock)
      ? Object.keys(exportsBlock)
          .filter((key) => key.startsWith('./') && key !== './package.json')
          .map((key) => key.slice(2))
          .sort()
      : [];
  if (subpaths.length === 0) {
    throw new PlatformRootUnresolvableError(
      `${declared[0]!.name} publishes no subpath. Every consumer of this list would walk ` +
        'nothing and report a clean result over an empty population.',
    );
  }
  return subpaths;
}

/** The same, reading the workspace at `repoRoot`. */
export function platformSubpathsAt(
  repoRoot: string,
  fs: WorkspaceFs = nodeWorkspaceFs(),
): readonly string[] {
  return platformSubpathsOf(workspaceMembers(repoRoot, fs));
}
