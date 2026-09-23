/**
 * The message ids Docusaurus derives from `docusaurus.config.js` and
 * `sidebars.js`, and the file it reads each of them from.
 *
 * The set is **derived, never listed**. `@docusaurus/theme-classic`'s
 * `lib/translations.js` builds `title`, `logo.alt` and `item.label.<Label>` for
 * the navbar and `copyright`, `logo.alt`, `link.title.<Title>` and
 * `link.item.label.<Label>` for the footer;
 * `@docusaurus/plugin-content-docs`'s builds
 * `sidebar.<name>.category.${category.key ?? category.label}`, its
 * `.link.generated-index.{title,description}` and
 * `sidebar.<name>.link.${link.key ?? link.label}`. Those functions are the
 * grammar this module re-applies, over the same two inputs. A hand-written id
 * list would be a second registry — one that goes stale the first time a navbar
 * item or a category is added, silently, which is the class of defect feature
 * 133 exists to close rather than repeat.
 *
 * **`sidebar.<name>.doc.*` is deliberately absent.** The plugin filters doc
 * items by `item.translatable`, and a bare `'some/doc'` entry — which is what
 * `sidebars.js` and `sidebars.modules.generated.js` are almost entirely made of
 * — is normalised with `translatable: false`. A Polish sidebar doc label comes
 * from the Polish page's own title, so those ids are inert in every file
 * (feature 133 T008, plan §B1). They are not *required* anywhere; they are
 * still refused in `code.json` through {@link sidebarNamespacePrefixes}.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';

/** Translation files, relative to `docs/i18n/<locale>/`. */
export const THEME_CLASSIC_NAVBAR_FILE = 'docusaurus-theme-classic/navbar.json';
export const THEME_CLASSIC_FOOTER_FILE = 'docusaurus-theme-classic/footer.json';
export const CONTENT_DOCS_CURRENT_FILE = 'docusaurus-plugin-content-docs/current.json';

/** The home of ids emitted by theme and plugin **components**, and of nothing else. */
export const CODE_JSON_FILE = 'code.json';

/** One expected chrome message: what Docusaurus calls it, and where it reads it. */
export interface ChromeMessage {
  /** The id as it is keyed inside {@link ChromeMessage.file}. */
  readonly id: string;
  /** Translation file, relative to `docs/i18n/<locale>/`. */
  readonly file: string;
  /**
   * The keys under which this id would sit in `code.json`, where Docusaurus
   * will never read it. The shipped defect spelled them with a `theme.` prefix
   * (`theme.navbar.title`), so the plain and the prefixed spelling are both
   * listed — an id parked under either is inert.
   */
  readonly codeJsonKeys: readonly string[];
}

/** The two config inputs the id set is derived from. */
export interface DocsChromeConfig {
  readonly themeConfig?: unknown;
  readonly sidebars?: unknown;
}

interface NavbarItemLike {
  readonly label?: unknown;
  readonly items?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function themeMessage(scope: 'navbar' | 'footer', id: string): ChromeMessage {
  return {
    id,
    file: scope === 'navbar' ? THEME_CLASSIC_NAVBAR_FILE : THEME_CLASSIC_FOOTER_FILE,
    codeJsonKeys: [`theme.${scope}.${id}`, `${scope}.${id}`],
  };
}

function sidebarMessage(id: string): ChromeMessage {
  return { id, file: CONTENT_DOCS_CURRENT_FILE, codeJsonKeys: [id] };
}

/** Every navbar item, sub-items included — the plugin flattens before keying. */
function flattenNavbarItems(items: readonly unknown[]): readonly NavbarItemLike[] {
  const flat: NavbarItemLike[] = [];
  for (const raw of items) {
    const item = asRecord(raw);
    if (item === null) {
      continue;
    }
    flat.push(item as NavbarItemLike);
    flat.push(...flattenNavbarItems(asArray(item['items'])));
  }
  return flat;
}

function navbarMessages(themeConfig: Record<string, unknown>): ChromeMessage[] {
  const navbar = asRecord(themeConfig['navbar']);
  if (navbar === null) {
    return [];
  }
  const messages: ChromeMessage[] = [];
  if (asString(navbar['title']) !== null) {
    messages.push(themeMessage('navbar', 'title'));
  }
  const logoAlt = asString(asRecord(navbar['logo'])?.['alt']);
  if (logoAlt !== null) {
    messages.push(themeMessage('navbar', 'logo.alt'));
  }
  for (const item of flattenNavbarItems(asArray(navbar['items']))) {
    const label = asString(item.label);
    if (label !== null) {
      messages.push(themeMessage('navbar', `item.label.${label}`));
    }
  }
  return messages;
}

function footerMessages(themeConfig: Record<string, unknown>): ChromeMessage[] {
  const footer = asRecord(themeConfig['footer']);
  if (footer === null) {
    return [];
  }
  const messages: ChromeMessage[] = [];
  const links = asArray(footer['links']);
  const multiColumn = links.length > 0 && asRecord(links[0])?.['title'] !== undefined;
  for (const raw of links) {
    const link = asRecord(raw);
    if (link === null) {
      continue;
    }
    if (multiColumn) {
      const title = asString(link['title']);
      if (title !== null) {
        messages.push(themeMessage('footer', `link.title.${title}`));
      }
      for (const rawItem of asArray(link['items'])) {
        const label = asString(asRecord(rawItem)?.['label']);
        if (label !== null) {
          messages.push(themeMessage('footer', `link.item.label.${label}`));
        }
      }
      continue;
    }
    const label = asString(link['label']);
    if (label !== null) {
      messages.push(themeMessage('footer', `link.item.label.${label}`));
    }
  }
  if (asString(footer['copyright']) !== null) {
    messages.push(themeMessage('footer', 'copyright'));
  }
  if (asString(asRecord(footer['logo'])?.['alt']) !== null) {
    messages.push(themeMessage('footer', 'logo.alt'));
  }
  return messages;
}

function sidebarItemMessages(items: readonly unknown[], sidebarName: string): ChromeMessage[] {
  const messages: ChromeMessage[] = [];
  for (const raw of items) {
    const item = asRecord(raw);
    if (item === null) {
      // A bare `'some/doc'` string: `translatable: false`, so no id at all.
      continue;
    }
    if (item['type'] === 'category') {
      const key = asString(item['key']) ?? asString(item['label']);
      if (key !== null) {
        const base = `sidebar.${sidebarName}.category.${key}`;
        messages.push(sidebarMessage(base));
        const link = asRecord(item['link']);
        if (link?.['type'] === 'generated-index') {
          if (asString(link['title']) !== null) {
            messages.push(sidebarMessage(`${base}.link.generated-index.title`));
          }
          if (asString(link['description']) !== null) {
            messages.push(sidebarMessage(`${base}.link.generated-index.description`));
          }
        }
      }
      messages.push(...sidebarItemMessages(asArray(item['items']), sidebarName));
      continue;
    }
    if (item['type'] === 'link') {
      const key = asString(item['key']) ?? asString(item['label']);
      if (key !== null) {
        messages.push(sidebarMessage(`sidebar.${sidebarName}.link.${key}`));
      }
      continue;
    }
    // `doc` and `ref` items: see the module header — no required id.
  }
  return messages;
}

function sidebarMessages(sidebars: Record<string, unknown>): ChromeMessage[] {
  const messages: ChromeMessage[] = [];
  for (const name of Object.keys(sidebars).sort()) {
    messages.push(...sidebarItemMessages(asArray(sidebars[name]), name));
  }
  return messages;
}

/** Every chrome id the two config files imply, sorted by file then id. */
export function chromeMessagesFor(config: DocsChromeConfig): readonly ChromeMessage[] {
  const themeConfig = asRecord(config.themeConfig) ?? {};
  const sidebars = asRecord(config.sidebars) ?? {};
  const messages = [
    ...navbarMessages(themeConfig),
    ...footerMessages(themeConfig),
    ...sidebarMessages(sidebars),
  ];
  const seen = new Set<string>();
  return messages
    .filter((message) => {
      const key = `${message.file}:${message.id}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.file.localeCompare(b.file) || a.id.localeCompare(b.id));
}

/**
 * The `code.json` key prefixes that belong to the content-docs plugin.
 *
 * Every id under them is read from `current.json` or from nowhere, so its
 * presence in `code.json` is inert whatever it is — including the
 * `sidebar.<name>.doc.*` ids no sidebar derives any more.
 */
export function sidebarNamespacePrefixes(sidebars: unknown): readonly string[] {
  const record = asRecord(sidebars) ?? {};
  return Object.keys(record)
    .sort()
    .map((name) => `sidebar.${name}.`);
}

/** Sidebar ids a locale must actually carry: categories and links, never docs (T008). */
export function requiredSidebarMessageIds(ids: readonly string[]): readonly string[] {
  return ids.filter((id) => !/^sidebar\.[^.]+\.doc\./.test(id));
}

/**
 * `require` the two config files.
 *
 * Both are plain CommonJS that import nothing from Docusaurus —
 * `docusaurus.config.js` reads `locales.config.json`, `sidebars.js` reads
 * `sidebars.modules.generated.js` — so this stays a service-free, build-free
 * read, which is what keeps the check in the `quality` job.
 */
export function loadDocsChromeConfig(docsMemberDir: string): DocsChromeConfig {
  const require = createRequire(join(docsMemberDir, 'noop.cjs'));
  const config = require(join(docsMemberDir, 'docusaurus.config.js')) as Record<string, unknown>;
  const sidebars = require(join(docsMemberDir, 'sidebars.js')) as Record<string, unknown>;
  return { themeConfig: config['themeConfig'], sidebars };
}

/** The config files this module reads, for the check's read-size accounting. */
export function docsChromeConfigPaths(docsMemberDir: string): readonly string[] {
  return [
    join(docsMemberDir, 'docusaurus.config.js'),
    join(docsMemberDir, 'sidebars.js'),
    join(docsMemberDir, 'sidebars.modules.generated.js'),
  ];
}
