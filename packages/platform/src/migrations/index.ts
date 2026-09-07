/**
 * `./migrations` — the platform's seventh subpath, and the platform's own claim
 * about its schema history.
 *
 * ## What is on it
 *
 * {@link BASELINE_MIGRATIONS}: the frozen historical prefix, as an ordered list
 * of migration class names.
 * `specs/110-instance-repository/contracts/instance-migration-order.md` is
 * normative and §1 is where every alternative to it is refused with the reason.
 *
 * The short version. The order a migration corpus is applied in is a frozen
 * historical prefix — the pre-065 block, whose order is history and which the
 * manifest graph contradicts in 37 places — followed by the modules, module by
 * module, in a topological order of that graph. Membership of the prefix used
 * to be `origin === 'core' && timestamp <= BASELINE_THROUGH`: *"came out of
 * this repository's build"*. That is a different question from *"is one of the
 * migrations whose order is history"*, and the two coincide exactly while every
 * module is compiled into the application. Measured over the real registry the
 * moment they come apart: the prefix falls from **112** entries to **11**, 181
 * of 182 positions move, and six migrations — three of them `core`'s — land
 * before the migration that creates a table they touch. An instance installing
 * the same modules could not migrate a fresh database at all, failing at
 * `Migration20260505T102206AssetsLibraryInit` with
 * `relation "cms_pages" does not exist`.
 *
 * So membership is by **identity**, and the identities are here.
 *
 * ## Why the platform carries it
 *
 * R1.5. It is data about *this platform's* history, a client receives it by
 * installing the platform, and a client receives a correction to it by
 * `pnpm update`. The alternative — an instance carrying the order — makes a
 * fact about our history the client's to hold, in a tree we cannot grep.
 *
 * ## Why no module may name it
 *
 * It is declared by the `exports` map and carried by no published barrel, which
 * is D-160.14's third state: `node` and `tsc` resolve it, and
 * `check:platform-surface` gives a module reaching it a finding of its own
 * (`host-internal-subpath`). The reader is the host's ORM configuration, which
 * is the one program that composes an execution order. A module's own
 * `./migrations` subpath is the other side of the same conversation and is
 * unaffected: it publishes that module's classes, and this publishes the order
 * the platform applies them in.
 */
export { BASELINE_MIGRATIONS } from './baseline-migrations.generated.js';
