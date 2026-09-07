/**
 * CI check — **English is the default**, so a prose literal in another language,
 * outside a per-language structure, in a module's own sources is a defect
 * (`specs/094-translation-boundary/`,
 * `contracts/default-language-prose-check.md`).
 *
 * The **second signal** for `contracts/translation-boundary.md` § 3 clause 1,
 * and a check of its own rather than a widening of either instrument that looks
 * like its home. `../research.md` § 8 D-8 records why:
 * `check:untranslated-delivery`'s predicate is *a delivery call that passes
 * prose and no key*, and a `return` is not a call, an array push is not a call
 * and a field assignment is not a call; `check:language`'s scope is **comments**
 * by constitutional design (Principle VIII v3.0.0 permits a string literal in
 * any language), and widening it would make every `{ en, pl }` map a violation.
 *
 * ## The predicate keys on the language of the string, not on how it is carried
 *
 * `specs/093-backend-delivered-prose/` named its population after three delivery
 * **mechanisms** — a notification port, a mailer, a pdfmake renderer — and
 * mechanisms are unbounded: six more shapes were in the tree the whole time (a
 * `return` from a route handler, a push into a persisted operation log, a
 * persisted document line item, a Polish default behind an operator-editable
 * prop, a CMS seed, a bilingual ternary), and **30 of the 36 sites were outside
 * the survey**. A string does not become user-facing by being carried; it
 * becomes user-facing by being read.
 *
 * So this check asks one question of the literal itself, and it answers for the
 * seventh shape nobody has written yet.
 *
 * ## The asymmetry is the rule rather than a limitation
 *
 * It finds non-English prose and says nothing about English prose. Under a
 * ruling that makes English the default, an English literal is not a finding —
 * so the check enforces the ruling **as written**. It is not an instrument for
 * "is this string translated"; that is `check:untranslated-delivery`'s question
 * for case 2 and `tsc`'s for the storefront.
 *
 * ## What "outside a per-language structure" means, derived from the syntax
 *
 * A filename rule is refused (`check:diacritic-folds`' exemption discipline):
 * the exemption is a property of the **structure**, so a per-language map in a
 * file with an ordinary name is exempt and a bare literal in a file called
 * `translations.pl-PL.ts` is not. Three shapes, all decided from the syntax:
 *
 *   * **`language-keyed-property`** — an enclosing property assignment, at any
 *     depth, whose key is a shipped language or a locale whose primary subtag is
 *     one: `'pl-PL': { … }`, `pl: 'Przesyłka wysłana'`. It is one shape and not
 *     two, because § 1.2's "an English sibling at the same depth under a
 *     language key" is the same fact read from the other member — the key that
 *     reaches *this* literal is already a language.
 *   * **`language-declaring-object`** — the enclosing object literal declares
 *     which language it is written in, in a property whose **name** is one of
 *     {@link LANGUAGE_DECLARING_FIELDS} and whose value is a shipped language.
 *     A `dictionaries` seed row is the shape —
 *     `{ entryType: 'currency', entryCode: 'PLN', languageCode: 'pl-PL', label: '…' }`
 *     — and the field **name** is load-bearing: the same row's
 *     `entryCode: 'en-US'` is the row's *subject*, not its language, so a rule
 *     reading "any sibling holding a language code" would exempt a countries
 *     seed keyed `code: 'pl'` as well.
 *   * **`single-language-file`** — the file's own declared subject is one
 *     language, evidenced by a language **code** in a declared export name
 *     (`export const PL_MESSAGES`, `messagesPlPL`). The other evidence § 1.2
 *     names, a manifest-declared bundle path, is vacuous here rather than
 *     unimplemented: a bundle directory holds `en.json` and `pl.json`, and this
 *     walk opens no JSON.
 *
 * ## Detection, and its declared bound
 *
 * Non-English detection is **Polish only**, by diacritic plus a stopword list,
 * reusing `scripts/check-language.sh`'s machinery and its `proper_nouns` list
 * ({@link POLISH_PROPER_NOUNS}, held to the shell list by the companion test).
 * The bound is declared rather than discovered: a check that claimed to detect
 * "any non-English prose" and detected Polish would be the thing this repository
 * refuses. Two consequences:
 *
 *   * **Polish prose carrying no diacritic and no stopword is invisible.**
 *     `'Nowa Organizacja'` is the measured example, and it is why the stopword
 *     list sits *beside* the diacritic class rather than instead of it:
 *     `'Zamówienie nie zostało opłacone'` is caught by `nie` when its diacritics
 *     are typed as `Zamowienie`.
 *   * **A third shipped language needs its own detector.** The set is derived
 *     from `SUPPORTED_LANGUAGES`, so the gap is visible the moment it grows: the
 *     `read:` line reconciles the two, and a shipped language with no detector
 *     is exit 2 rather than a silent implied coverage claim.
 *
 * ## What it does not see, stated rather than discovered later
 *
 *   * **A string assembled from fragments**, as a whole. Each fragment that is
 *     itself Polish prose is still a site — the two consent seeders are two
 *     concatenated literals each — but a sentence split so that no fragment is
 *     prose on its own is invisible.
 *   * **A single-word literal**, outside the prop-default position. A currency
 *     numeral table (`'pięć'`, `'sześćdziesiąt'`) and a unit (`'usł.'`) are not
 *     prose, and a token-count floor is the only thing separating them from a
 *     label; in the prop-default position the *position* supplies what the token
 *     count otherwise has to infer, so `str(props, 'labelPaid', 'Zapłacono')` is
 *     a finding and the numeral table is not.
 *   * **A module's `migrations/`.** Two reasons, and the first is sufficient: an
 *     applied migration cannot be edited, so the repair for a Polish seed there
 *     is a *new* migration and a ledger entry over the site would never drain.
 *     The second is that this tree's migration prose is per-language JSON inside
 *     a SQL string (`'{"en-US":"Card","pl-PL":"Karta płatnicza"}'::jsonb`), which
 *     a TypeScript structure analysis cannot see into and would report as bare
 *     Polish. The CMS consent seeders are services, not migrations, and stay in.
 *   * **A string read from a database or a fixture**, prose in a **comment**
 *     (`check:language`'s, deliberately), and `admin/` and `storefront/`
 *     sources, which are `i18n:hardcoded`'s and `tsc`'s respectively. `.tsx` is
 *     out of the walk for that last reason.
 *
 * ## The ledger
 *
 * `NON_ENGLISH_DEFAULTS`, sharded per module under {@link LEDGER_ROOT}
 * (`scripts/ledgers/non-english-defaults/`), one file per module exporting an
 * `entries` record, two-way, keyed `(file, digest of the literal)` — a **digest, never a line**, so an insertion above the site does not
 * red it and an edited sentence does.
 *
 * It opens holding the sites standing when it lands and is expected to
 * **empty**. An entry says why a non-English default is right; the only entries
 * that should survive are domain-mandated ones — the KSeF offline marking on a
 * Polish invoice is the standing example.
 *
 * Usage: `tsx scripts/check-default-language-prose.ts [--list]`
 * Exit 0 = every prose literal outside a per-language structure is English;
 * exit 1 = at least one is not, or an entry no longer describes one; exit 2 =
 * the run could not see the population it judges — no shipped language, no
 * registered module, a module walk that came back short, no literal read at
 * all, or no detector for a shipped language.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';


export type DefaultLanguageProseFindingKind =
  | 'non-english-default'
  | 'polish-default-behind-a-prop'
  | 'unclassifiable-literal';

/**
 * Polish diacritics — `scripts/check-language.sh`'s own `pattern`, character for
 * character, so the two instruments cannot come to disagree about what a Polish
 * letter is. `ó` is in it although it is shared with Icelandic and Spanish:
 * dropping it would make `'Potwierdzenie zamówienia'` invisible, which is a
 * larger hole than the two English currency labels it costs.
 */
export const POLISH_DIACRITICS = 'ąĄćĆęĘłŁńŃóÓśŚźŹżŻ';

const POLISH_DIACRITIC_RE = new RegExp(`[${POLISH_DIACRITICS}]`, 'u');

/**
 * Polish function words, for the prose that carries no diacritic.
 *
 * Function words only, and deliberately: a domain vocabulary would be a
 * population defined by the presence of the words somebody thought to enumerate
 * (issue #244). Every entry is a form that is not also an English word — `pod`,
 * `ten`, `to`, `do`, `on`, `z` and `we` are all excluded for that reason, and
 * their absence is why `'Data wystawienia'` is one of the blind spots § 1.3
 * declares. The exclusions are measured rather than assumed, twice:
 *
 *   * **`we`** (Polish "in") was in the list for one run and reported five
 *     English sentences, `'…and "we do not want files" is not a business
 *     decision'` among them.
 *   * **`w`** (Polish "in") is the single most useful Polish function word and is
 *     out for a different reason: it is **one letter**, and a one-letter token is
 *     not a word in a tree full of SQL aliases and XML namespaces. Measured: it
 *     found two real sites (`'Faktura wystawiona w trybie offline.'` and
 *     `'Numer w KSeF'`, both diacritic-free Polish) and eight wrong ones — a
 *     `select w.id, w.code …` join alias and seven `http://www.w3.org/…`
 *     signature algorithm URIs. Its absence is the second half of § 1.3's
 *     declared bound, and the two sites it costs are Polish legal artefacts a
 *     ledger entry would keep either way.
 *
 * So the stopword pass keeps {@link proseTokens}' floor: a token is a word when
 * it has two letters.
 */
export const POLISH_STOPWORDS: readonly string[] = [
  'aby',
  'albo',
  'bardzo',
  'bez',
  'czy',
  'dla',
  'gdy',
  'gdzie',
  'jak',
  'jako',
  'jest',
  'jeszcze',
  'jeśli',
  'już',
  'która',
  'które',
  'który',
  'lub',
  'może',
  'można',
  'nad',
  'nasz',
  'nasza',
  'nasze',
  'nie',
  'niż',
  'oraz',
  'przez',
  'przy',
  'się',
  'są',
  'także',
  'tego',
  'temu',
  'tylko',
  'tym',
  'twoja',
  'twoje',
  'twój',
  'wszystkie',
  'wtedy',
  'więc',
  'zostało',
  'zostały',
  'została',
  'został',
  'ze',
  'że',
  'żeby',
];

const STOPWORDS = new Set(POLISH_STOPWORDS);

/**
 * Polish proper nouns that stay Polish inside English prose — the list
 * `scripts/check-language.sh` carries, blanked before the detector runs for the
 * same reason it blanks them: an English sentence routinely names a Polish
 * institution, and translating the name would make it wrong rather than more
 * English.
 *
 * Held to the shell list, in both directions, by the companion test. Matched
 * **case-sensitively and as a whole phrase**, exactly as the shell does, so
 * `'Metoda płatności'` — an invoice label with a lower-case second word — is
 * still judged while the feature name `Metoda Płatności` is not.
 */
export const POLISH_PROPER_NOUNS: readonly string[] = [
  'Ministerstwo Finansów',
  'Biała lista',
  'Metoda Płatności',
  'Szybkie Zamówienia',
];

/**
 * Property names whose value declares which language the enclosing object is
 * written in — the `language-declaring-object` exemption.
 *
 * A vocabulary and not a derivation, because there is nothing in the tree that
 * declares it; it is kept to the four spellings that mean exactly this, and the
 * reason it cannot be widened to "a sibling holding a language code" is in the
 * header: a seed row's `entryCode: 'en-US'` is the row's subject.
 */
export const LANGUAGE_DECLARING_FIELDS: readonly string[] = [
  'lang',
  'language',
  'languageCode',
  'locale',
];

const DECLARING_FIELDS = new Set(LANGUAGE_DECLARING_FIELDS);

/** The languages a detector exists for. Polish, and § 1.3 declares the bound. */
export const DETECTED_LANGUAGES: readonly string[] = ['pl'];

/** How a literal is placed against the per-language structures around it. */
export type StructurePlacement =
  | 'language-keyed-property'
  | 'language-declaring-object'
  | 'single-language-file'
  | 'outside'
  | 'unclassifiable';

export interface ProseSite {
  /** The file, as `layout.keyOf` spells it. */
  readonly file: string;
  readonly line: number;
  /** The literal's own text, with template placeholders collapsed. */
  readonly text: string;
  /** The language the detector answered. */
  readonly language: string;
  readonly placement: StructurePlacement;
  readonly kind: DefaultLanguageProseFindingKind;
}

export interface DefaultLanguageProseInput {
  /** File key → source text. The top of the analysis (issue #130). */
  readonly sources: ReadonlyMap<string, string>;
  /** The platform's shipped languages — `SUPPORTED_LANGUAGES` in a real run. */
  readonly languages: readonly string[];
}

export interface DefaultLanguageProseResult {
  /** Every non-English prose literal outside a per-language structure. */
  readonly findings: readonly ProseSite[];
  /** Findings no ledger entry answers for. */
  readonly violations: readonly ProseSite[];
  /** Findings an entry answers for. */
  readonly ledgered: readonly ProseSite[];
  /** Ledger keys that no longer describe a finding. */
  readonly stale: readonly string[];
  /** Entries filed under a module that does not own the file they name. */
  readonly misfiled: readonly string[];
  /** Every string or template literal the walk classified — the `sites` count. */
  readonly classified: number;
}

// --- the detector ----------------------------------------------------------

/** The word tokens a literal holds — letters only, so a placeholder splits. */
export function proseTokens(text: string): string[] {
  return [...text.matchAll(/\p{L}[\p{L}'’-]*/gu)]
    .map((match) => match[0])
    .filter((token) => token.length >= 2);
}

/**
 * Whether the literal is prose at all.
 *
 * Two word tokens, or one in the prop-default position — see the header: there
 * the position establishes that the string is a label a human reads, which is
 * what the token count otherwise has to infer.
 */
export function isProse(text: string, inPropDefault = false): boolean {
  const tokens = proseTokens(text);
  return inPropDefault ? tokens.length >= 1 : tokens.length >= 2;
}

/** The proper nouns removed, so a citation is not read as prose. */
export function blankProperNouns(text: string): string {
  let out = text;
  for (const noun of POLISH_PROPER_NOUNS) out = out.split(noun).join(' ');
  return out;
}

/** Whether the literal holds a Polish function word. */
export function hasPolishStopword(text: string): boolean {
  return proseTokens(text.toLowerCase()).some((token) => STOPWORDS.has(token));
}

/**
 * The non-English language this literal is in, or `null`.
 *
 * `languages` gates the answer: a detector for a language the platform does not
 * ship would report a finding nobody can act on.
 */
export function detectLanguage(text: string, languages: readonly string[]): string | null {
  const shipped = new Set(languages.map(primarySubtag));
  const cleaned = blankProperNouns(text);
  if (shipped.has('pl') && (POLISH_DIACRITIC_RE.test(cleaned) || hasPolishStopword(cleaned))) {
    return 'pl';
  }
  return null;
}

/** `pl-PL` → `pl`, and `PL` → `pl`. Case and region folded, nothing else. */
export function primarySubtag(code: string): string {
  const cut = code.indexOf('-');
  return (cut === -1 ? code : code.slice(0, cut)).toLowerCase();
}

/** Whether a property key or export-name token names a shipped language. */
function namesLanguage(token: string, languages: readonly string[]): boolean {
  const shipped = new Set(languages.map(primarySubtag));
  return shipped.has(primarySubtag(token));
}

// --- the structure analysis ------------------------------------------------

/**
 * What an interpolation collapses to.
 *
 * Written as an escape and not as the character, because a raw control byte in
 * a source file is invisible in every diff that would reveal it — the shape
 * `check:nul-bytes` exists for. An ellipsis rather than a space: it breaks a
 * token, so `` `Kwota${x}netto` `` reads as two words rather than one, and it
 * prints legibly in a finding and in a ledger entry's own label.
 */
const INTERPOLATION_PLACEHOLDER = '\u2026';

/** The text of a literal node, with an interpolation collapsed to a token break. */
function literalTextOf(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return (
      node.head.text +
      node.templateSpans
        .map((span) => `${INTERPOLATION_PLACEHOLDER}${span.literal.text}`)
        .join('')
    );
  }
  return null;
}

/**
 * Whether the literal is in a position where it is not prose at all: a module
 * specifier, a property **key**, a type, an enum member name.
 *
 * A key is excluded rather than judged because `{ 'Faktura korygująca': … }`
 * would be a data shape, not a sentence — and because the language-keyed
 * exemption reads keys itself.
 */
function isNonProsePosition(node: ts.Node): boolean {
  const parent = node.parent as ts.Node | undefined;
  if (parent === undefined) return true;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  if (ts.isImportTypeNode(parent) || ts.isModuleDeclaration(parent)) return true;
  if (ts.isLiteralTypeNode(parent)) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isPropertySignature(parent) && parent.name === node) return true;
  if (ts.isEnumMember(parent) && parent.name === node) return true;
  if (ts.isComputedPropertyName(parent)) return true;
  if (ts.isExternalModuleReference(parent)) return true;
  return false;
}

/**
 * Whether the literal sits in the **default** position of an operator-editable
 * prop read.
 *
 * Two shapes, both read off the call rather than off a callee's name — a name
 * rule would answer for `str(` and stop answering for whatever the next module
 * calls its accessor:
 *
 *   * the **last** argument of a call taking three or more, at least one of the
 *     earlier ones being a string literal (the prop key) —
 *     `str(props, 'labelSaleDate', 'Data sprzedaży')`;
 *   * the right operand of a `??` or `||` whose left operand is a property or
 *     element access — `props['labelSaleDate'] ?? 'Data sprzedaży'`.
 *
 * A ternary default (`typeof props['text'] === 'string' ? … : 'Dziękujemy…'`) is
 * outside it and lands in `non-english-default` instead: recognising it needs
 * the condition and the branch to be tied to one property, and the finding it
 * would move is reported either way.
 */
function isPropDefaultPosition(node: ts.Node): boolean {
  const parent = node.parent as ts.Node | undefined;
  if (parent === undefined) return false;
  if (ts.isCallExpression(parent)) {
    const args = parent.arguments;
    if (args.length < 3) return false;
    if (args[args.length - 1] !== node) return false;
    return args
      .slice(0, -1)
      .some((argument) => ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument));
  }
  if (ts.isBinaryExpression(parent) && parent.right === node) {
    const operator = parent.operatorToken.kind;
    if (
      operator !== ts.SyntaxKind.QuestionQuestionToken &&
      operator !== ts.SyntaxKind.BarBarToken
    ) {
      return false;
    }
    return (
      ts.isPropertyAccessExpression(parent.left) || ts.isElementAccessExpression(parent.left)
    );
  }
  return false;
}

/** Every name a file declares as an export, for the `single-language-file` shape. */
export function declaredExportNames(sf: ts.SourceFile): string[] {
  const names: string[] = [];
  const exported = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const statement of sf.statements) {
    if (ts.isVariableStatement(statement) && exported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
      }
      continue;
    }
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      exported(statement) &&
      statement.name !== undefined
    ) {
      names.push(statement.name.text);
    }
  }
  return names;
}

/** `POLISH_TRANSLATION_SEED` → `['POLISH', 'TRANSLATION', 'SEED']`. */
function nameTokens(name: string): string[] {
  return name
    .split(/[_\-.]/)
    .flatMap((part) => part.split(/(?<=[a-z0-9])(?=[A-Z])/))
    .filter((part) => part.length > 0);
}

/**
 * Whether the file's own declared subject is one language — § 1.2's third shape.
 *
 * The evidence is a language **code** in a declared export name. It deliberately
 * does not fire on `POLISH_TRANSLATION_SEED`, which is a language *name*: that
 * file is exempt through `language-declaring-object` instead, from the
 * `languageCode: 'pl-PL'` its rows carry, which is the structural answer and
 * needs no mapping from a code to an English word.
 */
export function isSingleLanguageFile(sf: ts.SourceFile, languages: readonly string[]): boolean {
  return declaredExportNames(sf).some((name) =>
    nameTokens(name).some((token) => namesLanguage(token, languages)),
  );
}

/**
 * Where the literal sits relative to the per-language structures enclosing it.
 *
 * A computed key anywhere on the path is `unclassifiable` and **not** a skip
 * (issue #113): `{ [language]: 'Przesyłka wysłana' }` may or may not be a
 * per-language map, and treating it as exempt is the direction that agrees with
 * the defect.
 */
export function placementOf(
  node: ts.Node,
  languages: readonly string[],
  singleLanguageFile: boolean,
): StructurePlacement {
  let unclassifiable = false;
  for (let current = node.parent as ts.Node | undefined; current; current = current.parent) {
    if (ts.isPropertyAssignment(current)) {
      if (ts.isComputedPropertyName(current.name)) {
        unclassifiable = true;
      } else if (
        (ts.isIdentifier(current.name) ||
          ts.isStringLiteral(current.name) ||
          ts.isNoSubstitutionTemplateLiteral(current.name)) &&
        namesLanguage(current.name.text, languages)
      ) {
        return 'language-keyed-property';
      }
    }
    if (ts.isObjectLiteralExpression(current) && declaresItsLanguage(current, languages)) {
      return 'language-declaring-object';
    }
  }
  if (singleLanguageFile) return 'single-language-file';
  return unclassifiable ? 'unclassifiable' : 'outside';
}

/** Whether the object literal names the language it is written in. */
function declaresItsLanguage(
  object: ts.ObjectLiteralExpression,
  languages: readonly string[],
): boolean {
  return object.properties.some((property) => {
    if (!ts.isPropertyAssignment(property)) return false;
    const name = ts.isIdentifier(property.name)
      ? property.name.text
      : ts.isStringLiteral(property.name)
        ? property.name.text
        : null;
    if (name === null || !DECLARING_FIELDS.has(name)) return false;
    const value = property.initializer;
    return (
      (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) &&
      namesLanguage(value.text, languages)
    );
  });
}

// --- the walk --------------------------------------------------------------

export interface FileAnalysis {
  readonly sites: readonly ProseSite[];
  /** Every literal node this file offered the classifier. */
  readonly classified: number;
}

/** Every non-English prose literal in one file, and how many it classified. */
export function analyzeSource(
  file: string,
  source: string,
  languages: readonly string[],
): FileAnalysis {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const singleLanguageFile = isSingleLanguageFile(sf, languages);
  const sites: ProseSite[] = [];
  let classified = 0;

  const visit = (node: ts.Node): void => {
    const text = literalTextOf(node);
    if (text !== null && !isNonProsePosition(node)) {
      classified += 1;
      const propDefault = isPropDefaultPosition(node);
      if (isProse(text, propDefault)) {
        const language = detectLanguage(text, languages);
        if (language !== null) {
          const placement = placementOf(node, languages, singleLanguageFile);
          if (placement === 'outside' || placement === 'unclassifiable') {
            sites.push({
              file,
              line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
              text,
              language,
              placement,
              kind:
                placement === 'unclassifiable'
                  ? 'unclassifiable-literal'
                  : propDefault
                    ? 'polish-default-behind-a-prop'
                    : 'non-english-default',
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { sites, classified };
}

// --- the ledger ------------------------------------------------------------

/** One shard's declared entries, plus the module it is filed under. */
export interface LedgerShard {
  readonly moduleId: string;
  readonly entries: Readonly<Record<string, string>>;
}

/** The digest half of a ledger key — never a line (§ 2.1). */
export function literalDigest(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12);
}

/** `<file>:<digest>`, so an insertion above the site does not red it. */
export function ledgerKey(site: Pick<ProseSite, 'file' | 'text'>): string {
  return `${site.file}:${literalDigest(site.text)}`;
}

/**
 * The findings, over the sources and shipped languages handed in.
 *
 * Pure: a red proof enters here, over **source text**, which is where a real run
 * enters (issue #130). A fixture handing in a classified literal would prove the
 * reporter and leave the parser, the position filter, the detector and the whole
 * structure analysis unproven.
 */
export function checkDefaultLanguageProse(
  input: DefaultLanguageProseInput,
  shards: readonly LedgerShard[] = [],
  moduleOf: (file: string) => string | null = () => null,
): DefaultLanguageProseResult {
  const findings: ProseSite[] = [];
  let classified = 0;
  for (const [file, source] of input.sources) {
    const analysis = analyzeSource(file, source, input.languages);
    findings.push(...analysis.sites);
    classified += analysis.classified;
  }

  const owners = new Map<string, string>();
  const reasons = new Map<string, string>();
  for (const shard of shards) {
    for (const key of Object.keys(shard.entries)) {
      owners.set(key, shard.moduleId);
      reasons.set(key, shard.entries[key] ?? '');
    }
  }

  const seen = new Set<string>();
  const violations: ProseSite[] = [];
  const ledgered: ProseSite[] = [];
  const misfiled: string[] = [];
  for (const site of findings) {
    const key = ledgerKey(site);
    seen.add(key);
    if (!reasons.has(key)) {
      violations.push(site);
      continue;
    }
    ledgered.push(site);
    const owner = moduleOf(site.file);
    if (owner !== null && owners.get(key) !== owner) misfiled.push(key);
  }
  const stale = [...reasons.keys()].filter((key) => !seen.has(key)).sort();

  return { findings, violations, ledgered, stale, misfiled, classified };
}

// --- the CLI ---------------------------------------------------------------

/** Directories a module walk never descends into. */
/**
 * Directory names this rule's walk prunes wherever they occur under its root.
 *
 * `migrations` is the one that is a *rule* rather than a convenience, and its
 * reason is in this file's header: an applied migration cannot be edited, so a
 * ledger entry over a literal in one would never drain.
 */
export const PRUNED_DIRECTORIES: readonly string[] = [
  'node_modules',
  'dist',
  'build',
  'migrations',
];

const SKIPPED = new Set(PRUNED_DIRECTORIES);

/**
 * Whether a file is in this rule's population — the **one** membership
 * decision, asked by the walk and by anything that needs to know what the walk
 * would open.
 *
 * It is one function called from two places on purpose, in the idiom
 * `command-coverage.ts` states: while the prune the walk does for speed and the
 * rule the population states were two expressions of one predicate, one could go
 * missing without the other noticing. The second caller is `endora check`'s
 * package-scope floor, which has to know that a declared `./migrations` layer is
 * **not** expected of this rule — otherwise a package that publishes migrations
 * reports a short walk for a layer the rule excludes by design.
 */
export function isScannedPath(absolutePath: string, root: string): boolean {
  const posix = absolutePath.split('\\').join('/');
  const within = posix.slice(root.split('\\').join('/').length).split('/');
  if (within.slice(0, -1).some((segment) => SKIPPED.has(segment))) return false;
  return posix.endsWith('.ts') && !posix.endsWith('.d.ts') && !posix.endsWith('.test.ts');
}

/**
 * Every TypeScript source under `dir`, with the rule's own prunes applied.
 *
 * Exported because the population is part of the rule: two hosts computing
 * "which files this check reads" two ways is the shape that lets one of them go
 * half-blind.
 */
export function collectProseSources(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let directory: boolean;
    try {
      directory = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (directory) {
      if (SKIPPED.has(name)) continue;
      collectProseSources(full, out);
      continue;
    }
    if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every shard in `directory`, loaded.
 *
 * Rejects rather than returning an empty list when the directory is missing or a
 * shard fails to import: both are "read nothing", and the CLI turns the
 * rejection into exit 2.
 */
export async function loadLedgerShards(directory: string): Promise<LedgerShard[]> {
  if (!existsSync(directory)) {
    throw new Error('ledger directory missing — refusing to report a vacuous pass');
  }
  const shards: LedgerShard[] = [];
  for (const name of readdirSync(directory).sort()) {
    if (!name.endsWith('.ts')) continue;
    const moduleId = name.replace(/\.ts$/, '');
    let loaded: unknown;
    try {
      loaded = (await import(pathToFileURL(join(directory, name)).href)) as unknown;
    } catch (error) {
      throw new Error(`ledger shard '${moduleId}' failed to load: ${String(error)}`);
    }
    const entries = (loaded as { entries?: unknown }).entries;
    if (typeof entries !== 'object' || entries === null) {
      throw new Error(`ledger shard '${moduleId}' failed to load: it exports no 'entries' record`);
    }
    if (Object.keys(entries as object).length === 0) {
      throw new Error(`ledger shard '${moduleId}' declares no entry — delete the file instead`);
    }
    shards.push({ moduleId, entries: entries as Readonly<Record<string, string>> });
  }
  return shards;
}

/**
 * The remedy paragraph, one per finding kind.
 *
 * Exported because the remedy is part of the rule and not part of a host: an
 * author outside this checkout reads the same sentence this repository's run
 * prints, and a second wording would be a second answer to "what do I do".
 */
export const REMEDIES: Readonly<Record<DefaultLanguageProseFindingKind, string>> = {
  'non-english-default':
    'English is the default (AGENTS.md § i18n, owner ruling of 2026-09-01). Author the ' +
    'sentence in English and put the Polish in the module bundle. Which seam carries it is ' +
    "`specs/094-translation-boundary/contracts/translation-boundary.md` § 2: if the backend " +
    "can resolve the reader's language here, translate and ship the code (case 1); if it " +
    'cannot, ship a key, its params and an English fallback sentence (case 2); operator ' +
    'content is seeded per language and belongs in no bundle at all.',
  'polish-default-behind-a-prop':
    'The prop is operator-editable and the **default** behind it is Polish, so an operator ' +
    'who never edits the template gets a Polish document on an English deployment. Having a ' +
    'mechanism is not having an English default — that conflation excluded 18 of these once ' +
    'already (`../research.md` § 7.3). Make the default English and translate through the ' +
    "renderer's own `locale`.",
  'unclassifiable-literal':
    'The property path reaching this literal carries a computed key, so the analysis cannot ' +
    'say whether it is inside a per-language structure. Reported rather than skipped ' +
    '(issue #113): treating it as exempt is the direction that agrees with the defect. ' +
    'Write the language key as a literal, or move the literal out of the computed path.',
};
