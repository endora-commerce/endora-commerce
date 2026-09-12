/**
 * The documentation toolchain an instance's `docs/` member is written with
 * (`contracts/instance-tree.md` §2.4a; `specs/110-instance-repository/` T137).
 *
 * ## Why this is a declaration and not a derivation
 *
 * Every other range `endora new instance` writes is read off a manifest the run
 * resolved (R2.5a): the four platform peers come from
 * `@endora-commerce/platform`'s own `peerDependencies`, the admin member's build
 * tools from `@endora-commerce/admin-shell`'s optional peers, `typescript` from
 * the CLI's own manifest. That works because in each case a package **owns** the
 * statement — *"a host that mounts me is a Vite application"* is the shell's to
 * make.
 *
 * Nothing in the estate owns a statement about Docusaurus. No module package
 * peers on it, the platform does not, and the admin shell does not. Two
 * candidates were tried and both were wrong:
 *
 *   * **an optional `peerDependencies` entry on `@endora-commerce/cli`**, which
 *     is the shell's mechanism asked of the package that renders the
 *     navigation. Measured, and rejected on the measurement: pnpm's
 *     `auto-install-peers` is on by default and **installs an optional peer**
 *     — `packages/cli/node_modules/@docusaurus/` appeared after one
 *     `pnpm install --frozen-lockfile`, and 279 lines of lockfile moved with
 *     it. An instance's admin member declares this CLI as a `devDependency`, so
 *     every client with an operator interface and no documentation site would
 *     have installed a documentation toolchain;
 *   * **a `devDependencies` entry**, which a consumer never installs and which
 *     would be a range this package neither builds nor tests with — true of
 *     nothing, and therefore a statement nobody could check.
 *
 * ## So it is declared here, and **reconciled** against the site we build
 *
 * `packages/cli/test/new-instance/docs-toolchain.test.ts` holds every entry
 * below to this repository's own `docs/package.json` in **both** directions.
 * That is the honest owner of the statement: the Docusaurus we ask a client to
 * build their documentation with is the Docusaurus we build ours with, and a
 * bump on one side is a bump on the other in the same merge request. A range
 * that went stale silently is what R2.5a is about; a range a reviewer reads
 * beside its reason, held to a manifest that has to agree with it, is not that.
 *
 * A name removed from `docs/package.json` makes this red rather than making an
 * instance's manifest wrong later — and an entry with no range makes the member
 * an **omission** naming the name, never a guess.
 */

/** One package the documentation member declares, with the reason it is there. */
export interface DocsToolchainEntry {
  readonly name: string;
  /** The semver range, held to `docs/package.json`'s by the companion test. */
  readonly range: string;
  /** What the member cannot do without it. */
  readonly why: string;
}

/**
 * The two packages — and there are two, deliberately.
 *
 * `react` and `react-dom` are **not** here: `@docusaurus/core` declares both as
 * its own non-optional `peerDependencies`, which pnpm resolves, and declaring
 * them in the member would be a second spelling of a range Docusaurus already
 * owns. The type packages (`@docusaurus/types`, `@docusaurus/tsconfig`,
 * `@docusaurus/module-type-aliases`) are not here either, because §2.4a's
 * configuration files are `.js`: three more ranges to write two object
 * literals with is a trade the member does not make.
 */
export const DOCS_TOOLCHAIN: readonly DocsToolchainEntry[] = [
  {
    name: '@docusaurus/core',
    range: '^3.10.0',
    why: 'the site itself — the build, the router and the sidebar it is handed',
  },
  {
    name: '@docusaurus/preset-classic',
    range: '^3.10.0',
    why: "the `'classic'` preset the configuration names, which is what makes the docs plugin, the theme and the search available",
  },
];
