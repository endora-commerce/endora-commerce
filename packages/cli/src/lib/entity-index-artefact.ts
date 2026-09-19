/**
 * The entity index — one host's answer to *"which modules did I install, and
 * which entity classes did each of them publish?"*
 * (`specs/109-backend-test-kit/tasks.md` T065).
 *
 * ## Why a generated artefact and not a package
 *
 * A server-bound test writes rows, and to write one it needs the entity class
 * **the ORM registered**: a structurally identical copy read out of a package's
 * source is a class the ORM never discovered, and `em.find` against it answers
 * with nothing (D-160.6, D-160.6.1). A module package publishes one `entities`
 * array and **no entity class by name** (D-168), so the class is picked out of
 * that array by name — `@endora-commerce/test-kit/support`'s `entityNamedIn`,
 * which is the lookup half and holds no population.
 *
 * The population is where this has to be a generated file. *Which modules one
 * deployment installed* is the single fact a package that may name no module is
 * forbidden to know (109 R2.2, FR-001), which is why
 * `backend/test/helpers/package-entities.ts` is permanently host-owned and may
 * neither move into a module package nor be published by the kit
 * (`specs/084-small-f4-package-layout/contracts/module-package-layout.md` R10's
 * closing paragraph — *"do not re-open this on volume"*). This file is the
 * successor that paragraph names: the per-host artefact that gives a
 * **stranger's** host the same index, derived from their install rather than
 * from ours.
 *
 * ## One derivation, two populations
 *
 * `contracts/instance-repository.md` R3.5, exactly as `admin-artefacts.ts` is
 * shared: `endora generate` renders it over the packages an instance installed,
 * and `composer:generate` renders it over this repository's workspace members.
 * A second implementation inside either host would be two answers to one
 * question — and the one this repository holds would be the one nobody outside
 * could correct.
 *
 * ## What it deliberately does not import
 *
 * Nothing but the installed modules. A `satisfies InstalledEntityIndex` would
 * read better and would put a type-only import of `@endora-commerce/test-kit`
 * into a file every instance renders, including the overwhelming majority that
 * run no test and never install the kit. The shape is checked where it is used —
 * at `entityNamedIn`'s argument position — by the consumer that needs it.
 */
import { ModulePackageError, type ModulePackage } from './module-packages.js';

/**
 * The subpath a module package publishes its composition root on, and the
 * subpath the `entities` array comes off.
 *
 * Spelled rather than derived from the `exports` map's shape, because a module
 * package's key set is **closed** (`module-package-layout.md` §2.2) and this is
 * one of its keys: `MODULE_SUBPATH_MEANINGS` in
 * `backend/scripts/lib/package-identity-files.ts` refuses a published subpath it
 * has no meaning for, so `./backend` is a name and not a convention. Deriving it
 * from a target directory's last segment — the shape the admin layer needs,
 * because `./admin` is optional and a package may lay it out its own way — would
 * be answering a question nobody is asking here.
 */
const BACKEND_SUBPATH = './backend';

/** The symbol the artefact exports, named once so every consumer agrees. */
export const ENTITY_INDEX_EXPORT = 'installedModuleEntities';

/** One installed module, as the index names it. */
export interface EntityIndexEntry {
  /** `endora.id`, the identity of record (D-142) — the index's key. */
  readonly moduleId: string;
  /** The bare specifier of its published `./backend`. */
  readonly specifier: string;
}

/**
 * Every installed module package, sorted by module id.
 *
 * **A module that publishes no `./backend` is refused, not skipped.** A skip is
 * how a whole module goes missing from an index without a word, and the failure
 * then lands on whichever test asked for one of its entities — as
 * `ModuleNotInstalledError` for a module the client did install, which sends
 * them to look at their install instead of at the artefact. It is the same
 * reason `collectAdminContributions` refuses a package whose admin layer no
 * subpath covers.
 *
 * There is no *"has entities"* predicate and there deliberately cannot be one:
 * whether the array is empty is a runtime fact about a package's JavaScript, and
 * a generator that imported every installed module to find out would evaluate a
 * client's whole backend to render a test artefact. Seven of this repository's
 * own module packages publish an empty array, and an empty array in the index is
 * the correct, loud answer — `entityNamed` names every class the array does
 * declare, `(empty)` included.
 */
export function collectEntityIndexEntries(
  packages: readonly ModulePackage[],
): readonly EntityIndexEntry[] {
  const entries: EntityIndexEntry[] = [];
  for (const pkg of packages) {
    if (!pkg.exports.has(BACKEND_SUBPATH)) {
      const declared = [...pkg.exports.keys()].sort().join(', ') || '(none)';
      throw new ModulePackageError(
        `[composer] ${pkg.name} declares itself a module ('${pkg.moduleId}') and publishes no ` +
          `'${BACKEND_SUBPATH}' subpath (declared: ${declared}). That subpath is the ` +
          `composition root the platform calls and the one place a module's \`entities\` array ` +
          `is reachable from, so the entity index cannot name this module's classes at all. ` +
          `Leaving it out instead would report a module the client installed as one they did ` +
          `not, which sends them to look at their install rather than at this artefact.`,
      );
    }
    entries.push({
      moduleId: pkg.moduleId,
      specifier: `${pkg.name}/${BACKEND_SUBPATH.slice(2)}`,
    });
  }
  return [...entries].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
}

/** Where the artefact lands, relative to the workspace root a host owns. */
export function entityIndexOutputPathIn(root: string): string {
  // The backend member, and **outside its `src`**: the member's own tsconfig
  // sets `include: ['src']` with `rootDir: 'src'`, so a test artefact placed
  // there would join the production build, and a `.ts` outside `rootDir` is
  // TS6059 even for a type-only import. One path in both trees rather than one
  // per tree — in this repository it lands beside the rest of `backend/test`'s
  // own support files, which is where its only consumer already is.
  return `${root}/backend/test/entities.generated.ts`;
}

/** A JS identifier for one entry's import binding — by position, never by id. */
function entityBindingOf(index: number): string {
  return `entities${index}`;
}

/** A module id as an object key: bare when it is an identifier, quoted otherwise. */
function keyOf(moduleId: string): string {
  return /^[A-Za-z$_][A-Za-z0-9$_]*$/.test(moduleId) ? moduleId : `'${moduleId}'`;
}

/** The "do not edit" header a host's own generator overrides with its own. */
export const ENTITY_INDEX_HEADER =
  `// AUTO-GENERATED — DO NOT EDIT.\n` +
  `// Re-render it with \`endora generate\`; editing it by hand is undone by the\n` +
  `// next run, and a stale index is a test asking the ORM about a table nothing\n` +
  `// mapped.\n`;

/** Pure render of the entity index, exported so a test can drive it. */
export function emitEntityIndex(
  entries: readonly EntityIndexEntry[],
  header: string = ENTITY_INDEX_HEADER,
): string {
  const imports = entries
    .map(
      (entry, index) =>
        `import { entities as ${entityBindingOf(index)} } from '${entry.specifier}';`,
    )
    .join('\n');
  const body = entries
    .map((entry, index) => `  ${keyOf(entry.moduleId)}: ${entityBindingOf(index)},`)
    .join('\n');

  return `${header}//
// The entity index — every module **this host installed**, keyed by its module
// id, with the \`entities\` array that module published on its own \`./backend\`
// (\`specs/109-backend-test-kit/\` T065).
//
// ## What it is for
//
// A server-bound test writes rows, and a row needs the entity class **the ORM
// registered**. A module package publishes one \`entities\` array and no entity
// class by name (D-168), so a test picks the class out of the array:
//
//     import { entityNamedIn } from '@endora-commerce/test-kit/support';
//     import type { Widget as WidgetRow } from '@endora-commerce/mod-widgets/test-support';
//     import { ${ENTITY_INDEX_EXPORT} } from './entities.generated.js';
//
//     const Widget = entityNamedIn<WidgetRow>(${ENTITY_INDEX_EXPORT}, 'widgets', 'Widget');
//
// The **class** comes off the array, which is the one copy the ORM discovered;
// the **row type** comes off that module's \`./test-support\`, \`export type\` only,
// so nothing is evaluated twice (R10 property 3).
//
// ## Why it is generated and cannot be a package
//
// *Which modules one deployment installed* is the single fact a package that may
// name no module is forbidden to know (109 R2.2, FR-001). The kit therefore
// carries the lookup and the index's type and never a member of it, and this
// file — one per host, rendered from that host's own install — carries the
// population.
//
// **Resolution is by class name, never by position.** A tuple index compiles for
// any ordering, so re-ordering the array inside a module would silently re-point
// every caller at another table.

${imports}${imports === '' ? '' : '\n'}
/**
 * Every installed module's published entity classes, keyed by module id.
 *
 * A module with an empty array is a module that owns no table, which is a legal
 * state with a loud answer: asking for a class of it names every class it does
 * declare, \`(empty)\` included. A module that is **absent** is a different
 * answer — \`ModuleNotInstalledError\`, naming the ids that are here.
 */
export const ${ENTITY_INDEX_EXPORT} = {
${body}${body === '' ? '' : '\n'}};
`;
}
