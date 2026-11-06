import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  GENERIC_DOCUMENT_PAGE_DEFAULTS,
  isValidSectionPartition,
  type CreateDocumentTemplateBody,
  type DeleteDocumentTemplateBody,
  type DocumentBuilderConfig,
  type DocumentCollectionDeclaration,
  type DocumentCollectionDetail,
  type DocumentTemplateDetail,
  type DocumentTemplateListQuery,
  type DocumentTemplateSummary,
  type DocumentTypeDetail,
  type DocumentTypeSummary,
  type DocumentVariable,
  type PreviewDocumentBody,
  type RenameDocumentTemplateBody,
  type SaveDocumentTemplateContentBody,
  type VersionedBody,
  isUuidShape,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { SalesChannelResolutionPort } from '@endora-commerce/platform/kernel';
import {
  clearDefaultCommand,
  createTemplateCommand,
  deleteTemplateCommand,
  renameTemplateCommand,
  saveContentCommand,
  setDefaultCommand,
} from '../commands/document-template-commands.js';
import { DocumentTemplate } from '../entities/document-template.entity.js';
import type { DocumentTypeRegistry } from '../registry/document-type-registry.js';
import type { DocumentRenderer } from '../rendering/document-renderer.js';
import { numberItems, withSampleValues } from '../rendering/items-table.js';
import type { BlockDeclarations } from './block-declarations.js';
import { buildDocumentBuilderConfig } from './builder-descriptor.js';
import { assertEnvelopeLimits, assertLanguageAllowed, validateTree } from './content-validation.js';
import type { TemplateReader, TemplateRow } from './template-resolver.js';

/**
 * The document-template facility's management surface — what the admin API
 * (`contracts/document-templates-api.md`) calls.
 *
 * Every write is a Command run by the Command Bus (Constitution XIII); this
 * service decides **whether** a write may happen — the type is available, the
 * layout is valid for it, the channel exists — and the Command does it.
 *
 * **A template of a switched-off host is invisible, not gone** (FR-051): its
 * type is absent from the registry, so it is omitted from lists and answers
 * `DOCUMENT_TEMPLATE_NOT_FOUND` on a read or a write, and nothing deletes it.
 */

export interface DocumentTemplateServiceDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: CommandBus;
  readonly registry: DocumentTypeRegistry;
  readonly declarations: BlockDeclarations;
  readonly salesChannels: SalesChannelResolutionPort;
  readonly renderer: DocumentRenderer;
}

function channelName(name: Record<string, string> | undefined): string | null {
  if (!name) return null;
  return name['en-US'] ?? name['en'] ?? Object.values(name)[0] ?? null;
}

export class DocumentTemplateService {
  constructor(private readonly deps: DocumentTemplateServiceDeps) {}

  // ---------------------------------------------------------------------------
  // Types
  // ---------------------------------------------------------------------------

  private requireType(code: string) {
    const registration = this.deps.registry.get(code);
    if (!registration) {
      throw new HttpError(404, ERROR_CODES.DOCUMENT_TYPE_NOT_AVAILABLE, 'This document type is not available.', {
        documentType: code,
      });
    }
    return registration;
  }

  async listTypes(): Promise<DocumentTypeSummary[]> {
    const types = this.deps.registry.list();
    if (types.length === 0) return [];
    const rows = (await this.deps
      .emFactory()
      .getConnection()
      .execute(
        `select document_type, count(*)::int as n from document_templates where document_type in (${types
          .map(() => '?')
          .join(', ')}) group by document_type`,
        types.map((type) => type.code),
      )) as { document_type: string; n: number }[];
    const counts = new Map(rows.map((row) => [row.document_type, row.n]));
    return types.map((type) => ({
      code: type.code,
      moduleId: type.moduleId,
      labelKey: type.labelKey,
      ...(type.descriptionKey !== undefined ? { descriptionKey: type.descriptionKey } : {}),
      selection: type.selection,
      templateCount: counts.get(type.code) ?? 0,
    }));
  }

  async getType(code: string, language?: string): Promise<DocumentTypeDetail> {
    const registration = this.requireType(code);
    const [summary] = (await this.listTypes()).filter((type) => type.code === code);
    const builtInContent = registration.defaultContent();
    const sampleLanguage =
      language ?? registration.languages?.[0] ?? Object.keys(builtInContent.languages)[0] ?? 'en-US';
    const { styles: _styles, ...pageDefaults } = registration.pageDefaults ?? {};
    const variables: DocumentVariable[] = [
      { key: 'date', labelKey: 'variables.date', ownerModule: 'document_templates', scope: 'body' },
      ...(registration.variables ?? []).map(
        (variable): DocumentVariable => ({
          key: variable.key,
          labelKey: variable.labelKey,
          ownerModule: registration.moduleId,
          scope: 'body',
        }),
      ),
      { key: 'page', labelKey: 'variables.page', ownerModule: 'document_templates', scope: 'headerFooter' },
      { key: 'pages', labelKey: 'variables.pages', ownerModule: 'document_templates', scope: 'headerFooter' },
    ];
    const sample = registration.sampleData(sampleLanguage);
    const collections: DocumentCollectionDetail[] = [];
    for (const collection of this.deps.registry.collections(code)) {
      const catalogue = await this.deps.registry.catalogue(code, collection.key, sampleLanguage);
      const sampleItems = withSampleValues(numberItems(collection.items(sample)), catalogue.fields);
      collections.push({
        key: collection.key,
        labelKey: collection.labelKey,
        ownerModule: registration.moduleId,
        fields: [...catalogue.fields],
        summaryFields: [...catalogue.summaryFields],
        sampleItems,
        sampleSummary: { ...(collection.summary?.(sample) ?? {}) },
        sampleSections: sampleSectionsOf(collection, sample, sampleItems.length),
      });
    }
    return {
      ...summary!,
      languages: registration.languages ? [...registration.languages] : null,
      variables,
      sample,
      builtInContent,
      pageDefaults: { ...GENERIC_DOCUMENT_PAGE_DEFAULTS, ...pageDefaults },
      collections,
    };
  }

  builderConfig(code: string): DocumentBuilderConfig {
    this.requireType(code);
    return buildDocumentBuilderConfig(code, this.deps.registry, this.deps.declarations);
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  private async channelNames(): Promise<Map<string, string | null>> {
    const channels = await this.deps.salesChannels.listAll();
    return new Map(channels.map((channel) => [channel.id, channelName(channel.name)]));
  }

  private summaryOf(row: DocumentTemplate, names: Map<string, string | null>): DocumentTemplateSummary {
    return {
      id: row.id,
      documentType: row.documentType,
      name: row.name,
      salesChannelId: row.salesChannelId ?? null,
      salesChannelName: row.salesChannelId ? (names.get(row.salesChannelId) ?? null) : null,
      languages: Object.keys(row.content.languages),
      isDefault: row.isDefault,
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async list(query: DocumentTemplateListQuery): Promise<DocumentTemplateSummary[]> {
    this.requireType(query.type);
    const where: Record<string, unknown> = { documentType: query.type };
    if (query.salesChannelId !== undefined) {
      where['salesChannelId'] = query.salesChannelId === 'global' ? null : query.salesChannelId;
    } else if (query.applicableToChannel !== undefined) {
      where['$or'] = [{ salesChannelId: null }, { salesChannelId: query.applicableToChannel }];
    }
    const rows = await this.deps.emFactory().find(DocumentTemplate, where, { orderBy: { name: 'asc' } });
    const names = await this.channelNames();
    return rows.map((row) => this.summaryOf(row, names));
  }

  /** A row whose type is available, or `DOCUMENT_TEMPLATE_NOT_FOUND` — indistinguishable (FR-051). */
  private async requireRow(id: string): Promise<DocumentTemplate> {
    if (!isUuidShape(id)) {
      throw new HttpError(404, ERROR_CODES.DOCUMENT_TEMPLATE_NOT_FOUND, 'Document template not found.', { id });
    }
    const row = await this.deps.emFactory().findOne(DocumentTemplate, { id });
    if (!row || !this.deps.registry.get(row.documentType)) {
      throw new HttpError(404, ERROR_CODES.DOCUMENT_TEMPLATE_NOT_FOUND, 'Document template not found.', { id });
    }
    return row;
  }

  async get(id: string): Promise<DocumentTemplateDetail> {
    const row = await this.requireRow(id);
    const names = await this.channelNames();
    return { ...this.summaryOf(row, names), content: { schemaVersion: 1, languages: { ...row.content.languages } } };
  }

  // ---------------------------------------------------------------------------
  // Writes — each one Command
  // ---------------------------------------------------------------------------

  private invalid(message: string, details: Record<string, unknown>): HttpError {
    return new HttpError(422, ERROR_CODES.DOCUMENT_TEMPLATE_INVALID, message, details);
  }

  private async summaryAfter(row: DocumentTemplate): Promise<DocumentTemplateSummary> {
    return this.summaryOf(row, await this.channelNames());
  }

  async create(body: CreateDocumentTemplateBody): Promise<DocumentTemplateSummary> {
    const registration = this.requireType(body.documentType);
    if (body.salesChannelId !== null && !(await this.deps.salesChannels.getById(body.salesChannelId))) {
      throw this.invalid('This sales channel does not exist.', { salesChannelId: body.salesChannelId });
    }
    let content: DocumentTemplate['content'];
    let sourceTemplateId: string | null = null;
    if (body.source.kind === 'built_in') {
      const builtIn = registration.defaultContent();
      content = { schemaVersion: 1, languages: { ...builtIn.languages } };
    } else {
      if (!isUuidShape(body.source.templateId)) {
        throw this.invalid('The source template is not a template of this document type.', {
          templateId: body.source.templateId,
        });
      }
      const source = await this.deps.emFactory().findOne(DocumentTemplate, { id: body.source.templateId });
      if (!source || source.documentType !== body.documentType) {
        throw this.invalid('The source template is not a template of this document type.', {
          templateId: body.source.templateId,
        });
      }
      content = structuredClone({ schemaVersion: 1 as const, languages: source.content.languages });
      sourceTemplateId = source.id;
    }
    const { row } = await this.deps.commandBus.run(
      createTemplateCommand({
        id: randomUUID(),
        documentType: body.documentType,
        name: body.name,
        salesChannelId: body.salesChannelId,
        content,
        setDefault: body.setDefault,
        sourceTemplateId,
      }),
    );
    return this.summaryAfter(row);
  }

  async rename(id: string, body: RenameDocumentTemplateBody): Promise<DocumentTemplateSummary> {
    await this.requireRow(id);
    const { row } = await this.deps.commandBus.run(
      renameTemplateCommand({ id, name: body.name, expectedVersion: body.expectedVersion }),
    );
    return this.summaryAfter(row);
  }

  async saveContent(
    id: string,
    language: string,
    body: SaveDocumentTemplateContentBody,
  ): Promise<DocumentTemplateSummary> {
    const current = await this.requireRow(id);
    const registration = this.requireType(current.documentType);
    const languages = registration.languages ? [...registration.languages] : null;
    assertLanguageAllowed(language, { languages });
    const tree = validateTree(body.tree, {
      palette: this.deps.registry.palette(current.documentType),
      isDeclared: (name) => this.deps.declarations.isDeclared(name),
      languages,
      collections: this.deps.registry.collections(current.documentType).map((collection) => collection.key),
    });
    const { row } = await this.deps.commandBus.run(
      saveContentCommand({
        id,
        language,
        tree,
        expectedVersion: body.expectedVersion,
        assertEnvelope: assertEnvelopeLimits,
      }),
    );
    return this.summaryAfter(row);
  }

  async setDefault(id: string, body: VersionedBody): Promise<DocumentTemplateSummary> {
    await this.requireRow(id);
    const { row } = await this.deps.commandBus.run(setDefaultCommand({ id, expectedVersion: body.expectedVersion }));
    return this.summaryAfter(row);
  }

  async clearDefault(id: string, body: VersionedBody): Promise<DocumentTemplateSummary> {
    await this.requireRow(id);
    const { row } = await this.deps.commandBus.run(
      clearDefaultCommand({ id, expectedVersion: body.expectedVersion }),
    );
    return this.summaryAfter(row);
  }

  async delete(id: string, body: DeleteDocumentTemplateBody): Promise<void> {
    await this.requireRow(id);
    await this.deps.commandBus.run(
      deleteTemplateCommand({ id, expectedVersion: body.expectedVersion, confirmDefault: body.confirmDefault }),
    );
  }

  // ---------------------------------------------------------------------------
  // Preview — renders, writes nothing
  // ---------------------------------------------------------------------------

  async preview(body: PreviewDocumentBody): Promise<Uint8Array> {
    const registration = this.requireType(body.documentType);
    const languages = registration.languages ? [...registration.languages] : null;
    assertLanguageAllowed(body.language, { languages });
    const tree = validateTree(body.tree, {
      palette: this.deps.registry.palette(body.documentType),
      isDeclared: (name) => this.deps.declarations.isDeclared(name),
      languages,
      collections: this.deps.registry.collections(body.documentType).map((collection) => collection.key),
    });
    const result = await this.deps.renderer.render({
      documentType: body.documentType,
      salesChannelId: null,
      language: body.language,
      data: registration.sampleData(body.language),
      tree,
      preview: true,
    });
    return result.bytes;
  }
}

/** The resolver's reads over the entity — the defaults in one query, a row by id. */
export function templateReaderOver(emFactory: () => EntityManager): TemplateReader {
  const toRow = (row: DocumentTemplate): TemplateRow => ({
    id: row.id,
    name: row.name,
    documentType: row.documentType,
    salesChannelId: row.salesChannelId ?? null,
    isDefault: row.isDefault,
    version: row.version,
    content: row.content,
  });
  return {
    async findDefaults(documentType, salesChannelId) {
      const rows = await emFactory().find(DocumentTemplate, {
        documentType,
        isDefault: true,
        ...(salesChannelId === null
          ? { salesChannelId: null }
          : { $or: [{ salesChannelId: null }, { salesChannelId }] }),
      });
      return rows.map(toRow);
    },
    async findById(id) {
      if (!isUuidShape(id)) return null;
      const row = await emFactory().findOne(DocumentTemplate, { id });
      return row ? toRow(row) : null;
    },
    async findApplicable(documentType, salesChannelId) {
      const rows = await emFactory().find(
        DocumentTemplate,
        {
          documentType,
          ...(salesChannelId === null
            ? { salesChannelId: null }
            : { $or: [{ salesChannelId: null }, { salesChannelId }] }),
        },
        { orderBy: { name: 'asc' } },
      );
      return rows.map(toRow);
    },
  };
}

/**
 * Feature 159 — the sample's sections for the editor's canvas
 * (`specs/159-quote-request-item-groups/contracts/document-sections.md` §4): `[]`
 * when the collection declares none, and — as the renderer does — when the host
 * throws or answers a partition that does not cover the sample's lines.
 */
function sampleSectionsOf(
  collection: DocumentCollectionDeclaration,
  sample: unknown,
  itemCount: number,
): DocumentCollectionDetail['sampleSections'] {
  if (!collection.sections) return [];
  try {
    const sections = collection.sections(sample);
    return isValidSectionPartition(sections, itemCount)
      ? sections.map((section) => ({ ...section, itemIndexes: [...section.itemIndexes], summary: { ...section.summary } }))
      : [];
  } catch {
    return [];
  }
}
