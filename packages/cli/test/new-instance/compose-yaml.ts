/**
 * A block-mapping reader for the compose examples this package renders.
 *
 * ## Why a reader and not a grep
 *
 * `specs/122-layer-deployment-independence/tasks.md` T010 in its own words: *"a
 * test that greps the example for a string proves the string, not the file"*.
 * A compose example whose `depends_on` sat one level too deep, or whose `admin`
 * key landed beside `services` rather than under it, would satisfy every
 * substring assertion anybody would think to write and would be refused by
 * `docker compose` on the client's machine.
 *
 * ## Why not a YAML library
 *
 * Constitution IV. Nothing in this repository parses YAML today — measured,
 * `yaml` and `js-yaml` appear in no manifest — and a dependency added so that a
 * test can read a file the same test's subject wrote is the kind of machinery
 * that principle refuses. What is needed is the *structure* of a file whose
 * emitter is fifty lines away: block mappings, block sequences, comments,
 * scalars. That is what this reads, and it is deliberately **not** a YAML
 * implementation — flow mappings, multi-line scalars, anchors-as-values and
 * merge keys are all read as opaque strings, which is exactly what the
 * assertions want of them (`environment: *backend-env` is a fact about the
 * file, not a structure to expand).
 *
 * A construct this cannot read is therefore a construct the emitter must not
 * emit, and {@link parseComposeYaml} refuses rather than guessing: a document
 * with no `services` mapping raises, so an assertion can never pass over a file
 * this reader silently understood as empty.
 */

export type YamlNode = string | YamlMapping | readonly YamlNode[];
export interface YamlMapping {
  readonly [key: string]: YamlNode;
}

interface SourceLine {
  readonly indent: number;
  readonly text: string;
}

/** Blank lines and whole-line comments carry no structure. */
function sourceLines(text: string): readonly SourceLine[] {
  return text
    .split('\n')
    .filter((raw) => raw.trim().length > 0 && !raw.trimStart().startsWith('#'))
    .map((raw) => ({ indent: raw.length - raw.trimStart().length, text: raw.trim() }));
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && /^(['"]).*\1$/s.test(trimmed)) return trimmed.slice(1, -1);
  return trimmed;
}

function parseNode(
  lines: readonly SourceLine[],
  start: number,
  indent: number,
): { node: YamlNode; next: number } {
  if (start < lines.length && lines[start]!.indent === indent && lines[start]!.text.startsWith('- ')) {
    const items: YamlNode[] = [];
    let index = start;
    while (index < lines.length && lines[index]!.indent === indent && lines[index]!.text.startsWith('- ')) {
      items.push(unquote(lines[index]!.text.slice(2)));
      index += 1;
    }
    return { node: items, next: index };
  }

  const mapping: Record<string, YamlNode> = {};
  let index = start;
  while (index < lines.length && lines[index]!.indent === indent) {
    const line = lines[index]!;
    if (line.text.startsWith('- ')) break;
    const match = /^([^:]+):(?:[ \t]+(.*))?$/.exec(line.text);
    if (match === null) {
      throw new Error(
        `compose-yaml: line ${String(index + 1)} of the block at indent ${String(indent)} is ` +
          `neither \`key: value\`, \`key:\` nor \`- item\`: ${line.text}. The emitter wrote a ` +
          'construct this reader does not model, which is a construct it must not write.',
      );
    }
    const key = match[1]!.trim();
    // An anchor is a name for the block that follows, not a value: the compose
    // examples declare the backend's environment once as `x-backend-env:
    // &backend-env` and both backend services read it. Dropping the name and
    // keeping the block is what lets the reader see through the extension field
    // — and reading it as a scalar instead swallowed `services:` whole, which
    // this reader's own refusal caught rather than passing.
    const anchored = /^&(\S+)\s*(.*)$/.exec(match[2] ?? '');
    const inline = anchored === null ? match[2] : anchored[2];
    if (inline !== undefined && inline.length > 0) {
      mapping[key] = unquote(inline);
      index += 1;
      continue;
    }
    if (index + 1 < lines.length && lines[index + 1]!.indent > indent) {
      const nested = parseNode(lines, index + 1, lines[index + 1]!.indent);
      mapping[key] = nested.node;
      index = nested.next;
      continue;
    }
    mapping[key] = '';
    index += 1;
  }
  return { node: mapping, next: index };
}

/**
 * The document, refusing one that holds no `services` mapping.
 *
 * The refusal is the point: an assertion over `services` of a document this
 * reader understood as empty is vacuously clean, and a renderer that emitted
 * nothing is exactly what would produce one.
 */
export function parseComposeYaml(text: string): YamlMapping {
  const lines = sourceLines(text);
  if (lines.length === 0) throw new Error('compose-yaml: the document holds no content');
  const { node } = parseNode(lines, 0, lines[0]!.indent);
  if (typeof node === 'string' || Array.isArray(node)) {
    throw new Error('compose-yaml: the document is not a mapping');
  }
  const services = (node as YamlMapping)['services'];
  if (services === undefined || typeof services === 'string' || Array.isArray(services)) {
    throw new Error(
      'compose-yaml: the document holds no `services` mapping, so every assertion about ' +
        'the services it declares would pass over a file that declares none',
    );
  }
  return node as YamlMapping;
}

/** The service names the document declares, sorted. */
export function serviceNames(document: YamlMapping): readonly string[] {
  return Object.keys(document['services'] as YamlMapping).sort();
}

/** One `depends_on` edge, as `<service> -> <target> (<condition>)`. */
export interface DependsOnEdge {
  readonly from: string;
  readonly to: string;
  readonly condition: string;
}

/** Every `depends_on` edge in the document, sorted by `from` then `to`. */
export function dependsOnEdges(document: YamlMapping): readonly DependsOnEdge[] {
  const services = document['services'] as YamlMapping;
  const edges: DependsOnEdge[] = [];
  for (const [from, definition] of Object.entries(services)) {
    if (typeof definition === 'string' || Array.isArray(definition)) continue;
    const dependsOn = (definition as YamlMapping)['depends_on'];
    if (dependsOn === undefined || typeof dependsOn === 'string' || Array.isArray(dependsOn)) {
      continue;
    }
    for (const [to, clause] of Object.entries(dependsOn as YamlMapping)) {
      const condition =
        typeof clause === 'string' || Array.isArray(clause)
          ? String(clause)
          : String((clause as YamlMapping)['condition'] ?? '');
      edges.push({ from, to, condition });
    }
  }
  return edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}
