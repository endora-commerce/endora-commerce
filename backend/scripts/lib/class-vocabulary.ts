/**
 * The class-vocabulary analysis — both directions of *"a class a package
 * renders, and a class a design system defines"* (feature 110, T129b; owner
 * ruling D-219; `specs/110-instance-repository/contracts/admin-stylesheet-composition.md`
 * §3's last-but-one row and §7.1's two predicates).
 *
 * It is a module of its own so a test can drive it over **source text**: every
 * fixture in `backend/test/unit/scripts/class-vocabulary.test.ts` enters here,
 * at the top, with the stylesheet bytes and the `.tsx` bytes a real run reads
 * and none of the answers a real run computes (issue #130).
 *
 * ## The two predicates, and the one that has already been got wrong
 *
 * **P1, "defined".** A class token in a **rule prelude** of a published design
 * system stylesheet, comments stripped first. Not *"a `.foo` anywhere in the
 * file"*: a comment quoting `design-tokens.css` yields `.css` and a URL yields
 * `.w3`. Preludes are read across line breaks, which §7.1's own shell command
 * does not do — `.input,\n.select,\n.textarea {` costs it `.input`, and that is
 * the difference between its 22 and the shim's real 23.
 *
 * **P2, "rendered".** The token appears as a **whitespace-delimited whole
 * token** inside a string or template literal, in a **class-attribute
 * position**: `className=` or `class=`, or an argument of `cn(`, `clsx(`,
 * `classNames(` or `twMerge(`.
 *
 * Whole token, **never substring**, is the whole of why this analysis exists in
 * the shape it does. `grep -rl 'badge--'` matches `b2b-badge--success`, and that
 * one substring produced the measurement — *"11 module packages render the
 * `@layer components` shim"* — that moved the wrong third of the design system
 * into a package and left the two-thirds every renderer actually uses in the
 * client's tree. The honest number was zero.
 *
 * Class-attribute position, **not "any string literal"**, is the second half: 28
 * of the tokens `components.css` defines are unprefixed English words —
 * `.actions`, `.name`, `.count`, `.role`, `.table`, `.select`, `.code` — and
 * matched in any string literal, `name` reports the storefront's message
 * catalogue and `role` reports an organization member page.
 *
 * ## One hop, and why there is one
 *
 * A class attribute may name a **file-local binding** instead of a literal:
 * three `price_lists` screens write `const STATUS = { scheduled: 'b2b-badge
 * b2b-badge--info', … }` and render `className={STATUS[key]}`. Resolving one
 * hop — an identifier, a member access, or an object literal's property values
 * — is what keeps `b2b-badge--info` out of `unrendered-definition`, and it is
 * the discipline `check:off-state-coverage`'s subject resolver already uses. A
 * second hop, an import, or a value built at runtime is **not** followed, and a
 * class name this analysis cannot resolve is {@link ClassVocabularyFinding}
 * `unresolvable-class` — a finding, never a skip (issue #113).
 *
 * ## What `undefined-render`'s population is, and the one bound it declares
 *
 * A rendered token is judged only when its **namespace** — its first segment —
 * is one the design system declares. `flex`, `mb-4` and `text-sm` are outside
 * it by construction, because no framework's utility scale is enumerable from
 * here and a check that tried would be a safelist.
 *
 * That leaves one real collision and it is declared rather than discovered:
 * **Tailwind's own utilities can land inside a design-system namespace.** The
 * page builder owns `pb-*` and Tailwind spells padding-bottom `pb-4`; this
 * repository's `col-cb` puts `col-span-10` in the same position. So a token is
 * a **vocabulary name** — and therefore judged — when it carries a BEM
 * separator (`--` or `__`), which no utility spelling produces, **or** when its
 * last segment is not a scale index: a bare integer, a decimal, a fraction, a
 * bracketed arbitrary value, or one of `px`, `auto`, `full`, `none`.
 *
 * The rule is measured consistent with the vocabulary it protects: of the 201
 * tokens the design system defines today, **not one** would be excluded by it.
 * What it costs is a genuine `pb-4`-shaped vocabulary name, which nobody writes,
 * and what it buys is that this check needs no list of another framework's
 * utilities — which would be the derived fact D-100 forbids writing down, at
 * the worst available granularity.
 *
 * ## What it cannot see, stated here rather than discovered later
 *
 *   - a class name assembled at runtime beyond the one hop, or reached through
 *     an import: it is `unresolvable-class` when the *token* is computed inside
 *     a class attribute, and invisible when a whole attribute is a value from
 *     another file;
 *   - a class defined by a stylesheet that is **not** a published design system
 *     — a module's own `.css`, an inline `<style>`, a third-party sheet. Such a
 *     definition makes a render legitimate and this analysis will still report
 *     it, which is why `UNDEFINED_CLASS_RENDERS` is a ledger with reasons and
 *     not an empty ratchet;
 *   - whether a class that is defined and rendered is *correct*.
 */
import ts from 'typescript';

/** The helpers whose arguments are a class-attribute position (§7.1). */
const CLASS_HELPERS: ReadonlySet<string> = new Set(['cn', 'clsx', 'classNames', 'twMerge']);

/** The two JSX attributes that are a class-attribute position. */
const CLASS_ATTRIBUTES: ReadonlySet<string> = new Set(['className', 'class']);

/**
 * A last segment that indexes a scale rather than naming a thing.
 *
 * `4`, `0.5`, `1/2`, `[3px]`, `px`, `auto`, `full`, `none`. See the header: this
 * is the one bound `undefined-render` declares, and it is what keeps `pb-4` and
 * `col-span-10` out of a population whose namespaces the design system owns.
 */
const SCALE_INDEX = /^(?:\d+(?:\.\d+)?(?:\/\d+)?|\[[^\]]*\]|px|auto|full|none)$/;

/**
 * Is this expression a **literal shape** — something a class attribute could be
 * spelled as, rather than something that merely happens to be in scope?
 *
 * See {@link classAttributeSites}: this is what stops the one hop from
 * wandering into a boolean whose own body carries an unrelated template.
 */
function isLiteralShaped(node: ts.Expression): boolean {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node) ||
    ts.isObjectLiteralExpression(node) ||
    (ts.isAsExpression(node) && isLiteralShaped(node.expression))
  );
}

/**
 * Does every string this substitution can yield **separate** the class tokens
 * around it — that is, is it empty or does it begin (or end) with whitespace?
 *
 * `` `b2b-btn b2b-btn--sm${active ? ' b2b-btn--primary' : ''}` `` is the shape
 * the tree writes, twice, and every class name in it is a whole literal: the
 * substitution's own branches are `' b2b-btn--primary'` and `''`. Without this,
 * the head's last token reads as glued and a fully literal attribute is reported
 * `unresolvable-class`.
 *
 * It fails **closed**: an expression that yields no literal at all — `${variant}`
 * — separates nothing, so the boundary stays glued and the site is a finding.
 * That is the direction issue #113 requires.
 */
function yieldsOnlySeparatedText(node: ts.Expression, edge: 'start' | 'end'): boolean {
  const texts: string[] = [];
  const collect = (current: ts.Node): void => {
    if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
      texts.push(current.text);
      return;
    }
    if (ts.isTemplateExpression(current)) {
      texts.push(edge === 'start' ? current.head.text : current.templateSpans.at(-1)!.literal.text);
      return;
    }
    ts.forEachChild(current, collect);
  };
  collect(node);
  if (texts.length === 0) return false;
  return texts.every((text) => text === '' || (edge === 'start' ? /^\s/ : /\s$/).test(text));
}

/** Every finding kind, and the estate's rule that none of them is a skip. */
export type ClassVocabularyFindingKind =
  /** A package renders a class in a design-system namespace that nothing defines. */
  | 'undefined-render'
  /** A design system defines a class no file renders. */
  | 'unrendered-definition'
  /** A class name computed inside a class attribute — a finding, never a skip. */
  | 'unresolvable-class'
  /** A ledger entry that no longer describes the tree. */
  | 'stale-ledger-entry';

export interface ClassVocabularyFinding {
  readonly kind: ClassVocabularyFindingKind;
  /** Repository-relative, POSIX. Empty for a ledger entry with no live site. */
  readonly file: string;
  readonly line: number | null;
  /** The class token, or the ledger key for a stale entry. */
  readonly token: string;
  readonly detail: string;
}

/** One class-attribute position the walk read. */
export interface ClassAttributeSite {
  readonly file: string;
  readonly line: number;
  /** Every whole token the position's literals spell. */
  readonly tokens: readonly string[];
  /** Whether a token in this position is assembled from a substitution. */
  readonly computed: boolean;
}

export interface DefinedVocabulary {
  /** Every class token the stylesheet's rule preludes name. */
  readonly tokens: ReadonlySet<string>;
  /** Rule preludes read — the disclosure that P1 saw a stylesheet at all. */
  readonly preludes: number;
}

/**
 * P1 — every class token in a rule prelude, comments stripped first.
 *
 * Preludes are taken between brace boundaries rather than line by line, which is
 * what catches a multi-line selector list and a rule nested inside `@media`.
 */
export function definedClasses(css: string): DefinedVocabulary {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens = new Set<string>();
  let preludes = 0;
  for (const match of withoutComments.matchAll(/([^{}]*)\{/g)) {
    const prelude = match[1] ?? '';
    if (prelude.trim() === '') continue;
    preludes += 1;
    for (const found of prelude.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) {
      tokens.add(found[1]!);
    }
  }
  return { tokens, preludes };
}

/**
 * P2 — every class-attribute position in one source file.
 *
 * The `file` is used verbatim as the site's key, so a caller passes the
 * repository-relative path it wants reported.
 */
export function classAttributeSites(source: string, file: string): readonly ClassAttributeSite[] {
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  // One hop: every file-local binding, by name. A `const` initialised with a
  // string literal or an object literal is what the three `price_lists` status
  // maps are, and resolving it is the difference between `b2b-badge--info`
  // being rendered and being reported as defined by nobody.
  //
  // Only a **literal-shaped** initializer is followed — a string, a template or
  // an object literal. That is not fastidiousness: `route-tabs.tsx` writes
  // `const isActive = pathname === to || pathname.startsWith(`${to}/`)` and
  // renders `cn('b2b-tab', isActive && 'is-active')`, so a hop that followed any
  // binding would reach that template's glued substitution and report a
  // perfectly literal class attribute as `unresolvable-class`. Measured: four
  // such sites, all of them false. A conditional or a concatenation is not
  // followed either, which is a bound and is declared in the header.
  const bindings = new Map<string, ts.Expression>();
  const collectBindings = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isLiteralShaped(node.initializer)
    ) {
      bindings.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collectBindings);
  };
  collectBindings(parsed);

  const sites: ClassAttributeSite[] = [];

  const read = (position: ts.Node): void => {
    const tokens: string[] = [];
    let computed = false;
    const seen = new Set<ts.Node>();

    const visit = (node: ts.Node, hops: number): void => {
      if (seen.has(node)) return;
      seen.add(node);

      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        for (const token of node.text.split(/\s+/)) if (token !== '') tokens.push(token);
        return;
      }

      if (ts.isTemplateExpression(node)) {
        // Static chunks count as literals; a chunk **glued** to a substitution
        // is a class name assembled at runtime and is `unresolvable-class`.
        // `` `b2b-btn b2b-btn--sm${active ? ' b2b-btn--primary' : ''}` `` is the
        // shape the tree writes, and every name in it is still a whole literal.
        const chunks = [node.head, ...node.templateSpans.map((span) => span.literal)];
        for (let index = 0; index < chunks.length; index += 1) {
          const raw = chunks[index]!.text;
          const parts = raw.split(/\s+/);
          for (let part = 0; part < parts.length; part += 1) {
            const text = parts[part]!;
            if (text === '') continue;
            const gluedLeft =
              part === 0 &&
              index > 0 &&
              !/^\s/.test(raw) &&
              !yieldsOnlySeparatedText(node.templateSpans[index - 1]!.expression, 'end');
            const gluedRight =
              part === parts.length - 1 &&
              index < chunks.length - 1 &&
              !/\s$/.test(raw) &&
              !yieldsOnlySeparatedText(node.templateSpans[index]!.expression, 'start');
            if (gluedLeft || gluedRight) computed = true;
            else tokens.push(text);
          }
        }
        for (const span of node.templateSpans) visit(span.expression, hops);
        return;
      }

      if (ts.isObjectLiteralExpression(node)) {
        for (const property of node.properties) {
          if (ts.isPropertyAssignment(property)) visit(property.initializer, hops);
        }
        return;
      }

      if (hops > 0) {
        if (ts.isIdentifier(node)) {
          const bound = bindings.get(node.text);
          if (bound) visit(bound, hops - 1);
          return;
        }
        if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
          let base: ts.Node = node.expression;
          while (ts.isPropertyAccessExpression(base) || ts.isElementAccessExpression(base)) {
            base = base.expression;
          }
          if (ts.isIdentifier(base)) {
            const bound = bindings.get(base.text);
            if (bound) visit(bound, hops - 1);
            return;
          }
        }
      }

      ts.forEachChild(node, (child) => visit(child, hops));
    };

    visit(position, 1);
    if (tokens.length === 0 && !computed) return;
    sites.push({
      file,
      line: parsed.getLineAndCharacterOfPosition(position.getStart(parsed)).line + 1,
      tokens,
      computed,
    });
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      CLASS_ATTRIBUTES.has(node.name.text) &&
      node.initializer
    ) {
      // One position, not two. The initializer is usually `cn(...)`, and
      // descending into it as well would report the same attribute twice — once
      // whole and once per argument — which inflates `sites` and reports one
      // computed name as several. A helper's `cn(...)` outside a class attribute
      // is still its own position, which is the case this rule is for.
      read(node.initializer);
      return;
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : '';
      if (CLASS_HELPERS.has(name)) for (const argument of node.arguments) read(argument);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return sites;
}

/**
 * Every namespace the design system declares — a defined token's first segment.
 *
 * A single-word definition (`.actions`, `.table`) declares no namespace: its
 * family has one member and there is nothing an undefined sibling could be.
 */
export function declaredNamespaces(defined: ReadonlySet<string>): ReadonlySet<string> {
  const namespaces = new Set<string>();
  for (const token of defined) {
    const separator = token.indexOf('-');
    if (separator > 0) namespaces.add(token.slice(0, separator));
  }
  return namespaces;
}

/**
 * Is this token a **vocabulary name** rather than a utility framework's scale
 * index? See the header — this is `undefined-render`'s one declared bound.
 */
export function isVocabularyName(token: string): boolean {
  if (token.includes('--') || token.includes('__')) return true;
  const segments = token.split('-');
  const last = segments[segments.length - 1] ?? '';
  return !SCALE_INDEX.test(last);
}

/** A ledger entry: the reason its author wrote for it. */
export type ClassLedger = Readonly<Record<string, string>>;

export interface ClassVocabularyInput {
  /** Published design system stylesheets: repository-relative path -> CSS. */
  readonly stylesheets: ReadonlyMap<string, string>;
  /** Every file the render walk opened: repository-relative path -> source. */
  readonly sources: ReadonlyMap<string, string>;
  /** Definitions nothing renders, keyed by class token. */
  readonly unrendered: ClassLedger;
  /** Renders nothing defines, keyed `<file>::<token>`. */
  readonly undefinedRenders: ClassLedger;
}

export interface ClassVocabularyResult {
  readonly findings: readonly ClassVocabularyFinding[];
  readonly defined: ReadonlySet<string>;
  readonly namespaces: ReadonlySet<string>;
  readonly sites: readonly ClassAttributeSite[];
  /** Every defined token at least one site renders. */
  readonly rendered: ReadonlySet<string>;
  readonly preludes: number;
}

/** The key an `undefined-render` ledger entry carries. */
export function undefinedRenderKey(file: string, token: string): string {
  return `${file}::${token}`;
}

/**
 * Both directions, over one population.
 *
 * Every finding kind is reported apart from every other, so a repair in one
 * cannot hide a hole in another — `unrendered-definition` going green while
 * `undefined-render` is blind is exactly the pair this rule exists to keep
 * honest.
 */
export function checkClassVocabulary(input: ClassVocabularyInput): ClassVocabularyResult {
  const defined = new Set<string>();
  let preludes = 0;
  for (const css of input.stylesheets.values()) {
    const read = definedClasses(css);
    for (const token of read.tokens) defined.add(token);
    preludes += read.preludes;
  }
  const namespaces = declaredNamespaces(defined);

  const sites: ClassAttributeSite[] = [];
  for (const [file, source] of input.sources) {
    sites.push(...classAttributeSites(source, file));
  }

  const findings: ClassVocabularyFinding[] = [];
  const rendered = new Set<string>();
  const undefinedSeen = new Set<string>();

  for (const site of sites) {
    if (site.computed) {
      findings.push({
        kind: 'unresolvable-class',
        file: site.file,
        line: site.line,
        token: '(computed)',
        detail:
          'a class name is assembled from a substitution inside a class attribute, so neither ' +
          'direction of this rule can be decided for it. Write the name as a whole literal — ' +
          '`cn(base, active && "b2b-btn--primary")` rather than `` `b2b-btn--${variant}` `` — ' +
          'so that adding a class to a component and defining it stay one reviewable pair.',
      });
      continue;
    }
    for (const token of site.tokens) {
      if (defined.has(token)) {
        rendered.add(token);
        continue;
      }
      const separator = token.indexOf('-');
      const namespace = separator > 0 ? token.slice(0, separator) : token;
      if (!namespaces.has(namespace)) continue;
      if (!isVocabularyName(token)) continue;
      const key = undefinedRenderKey(site.file, token);
      undefinedSeen.add(key);
      if (input.undefinedRenders[key] !== undefined) continue;
      findings.push({
        kind: 'undefined-render',
        file: site.file,
        line: site.line,
        token,
        detail:
          `\`${token}\` is in the \`${namespace}\` namespace the design system declares and no ` +
          'published stylesheet defines it, so this element renders unstyled in every instance ' +
          'and nothing else says so. Define it in the design system package, or render a class ' +
          'that is defined.',
      });
    }
  }

  for (const token of [...defined].sort()) {
    if (rendered.has(token)) continue;
    if (input.unrendered[token] !== undefined) continue;
    findings.push({
      kind: 'unrendered-definition',
      file: '',
      line: null,
      token,
      detail:
        `\`.${token}\` is defined by the design system and no file renders it. A class name a ` +
        'package publishes is surface it owes semantic versioning on; delete it, or record it ' +
        'in `UNRENDERED_CLASS_DEFINITIONS` with the reason it stands.',
    });
  }

  for (const token of Object.keys(input.unrendered).sort()) {
    if (!defined.has(token)) {
      findings.push({
        kind: 'stale-ledger-entry',
        file: '',
        line: null,
        token,
        detail:
          `\`UNRENDERED_CLASS_DEFINITIONS\` holds \`${token}\` and no design system defines it. ` +
          'The definition is gone; remove the entry.',
      });
      continue;
    }
    if (rendered.has(token)) {
      findings.push({
        kind: 'stale-ledger-entry',
        file: '',
        line: null,
        token,
        detail:
          `\`UNRENDERED_CLASS_DEFINITIONS\` holds \`${token}\` and a file now renders it. The ` +
          'entry describes nothing; remove it.',
      });
    }
  }

  for (const key of Object.keys(input.undefinedRenders).sort()) {
    if (undefinedSeen.has(key)) continue;
    findings.push({
      kind: 'stale-ledger-entry',
      file: key.split('::')[0] ?? '',
      line: null,
      token: key.split('::')[1] ?? key,
      detail:
        `\`UNDEFINED_CLASS_RENDERS\` holds \`${key}\` and this walk found no such render. ` +
        'Either the render is gone or the class is now defined; remove the entry.',
    });
  }

  return { findings, defined, namespaces, sites, rendered, preludes };
}
