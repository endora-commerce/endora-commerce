import { describe, expect, it } from 'vitest';
import {
  EntityExtensionDriftError,
  EntityExtensionInvalidError,
  EntityExtensionLoaderOutputError,
} from './errors.js';

/**
 * `specs/187-side-table-extensions/` T008 — every refusal names the module, its
 * origin, the table and the remedy, so an operator reading one line can act on
 * it (`contracts/entity-extension-declaration.md` §3, `verification-rules.md` §4).
 */
describe('EntityExtensionInvalidError', () => {
  it('carries the rule, module, origin, table, host reference and detail, and names them', () => {
    const error = new EntityExtensionInvalidError({
      rule: 'host-not-a-dependency',
      moduleId: 'acme_erp',
      origin: 'package',
      table: 'acme_erp_organization_links',
      entity: 'organizations.Organization',
      detail: 'add "organizations" to the manifest\'s dependencies',
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('EntityExtensionInvalidError');
    expect(error.code).toBe('entity_extension_invalid');
    expect(error.rule).toBe('host-not-a-dependency');
    expect(error.moduleId).toBe('acme_erp');
    expect(error.origin).toBe('package');
    expect(error.table).toBe('acme_erp_organization_links');
    expect(error.entity).toBe('organizations.Organization');
    expect(error.message).toContain('(host-not-a-dependency)');
    expect(error.message).toContain('module "acme_erp" (package)');
    expect(error.message).toContain('"acme_erp_organization_links"');
    expect(error.message).toContain('organizations.Organization');
    expect(error.message).toContain('add "organizations" to the manifest\'s dependencies');
  });

  it('reads without a module or table where the rule has none (M0 is about a binding)', () => {
    const error = new EntityExtensionInvalidError({
      rule: 'host-binding-mismatch',
      moduleId: null,
      origin: null,
      table: 'organizations',
      entity: 'organizations.Organization',
      detail: 'the entity mapping "organizations" is "Org"',
    });
    expect(error.message).toContain('(host-binding-mismatch)');
    expect(error.message).not.toContain('module "null"');
  });
});

describe('EntityExtensionDriftError', () => {
  it('lists every finding at once, each with module, origin, table, host and detail', () => {
    const error = new EntityExtensionDriftError([
      {
        rule: 'foreign-key-not-cascade',
        moduleId: 'acme_links',
        origin: 'package',
        table: 'acme_links_organization_refs',
        host: 'organizations.Organization',
        detail: 'its foreign key acme_links_organization_refs_org_fk is on delete restrict; make it on delete cascade',
      },
      {
        rule: 'table-missing',
        moduleId: 'quote_requests',
        origin: 'core',
        table: 'quote_request_org_policies',
        host: 'organizations.Organization',
        detail: 'the table does not exist; run migrate up',
      },
    ]);
    expect(error.name).toBe('EntityExtensionDriftError');
    expect(error.findings).toHaveLength(2);
    expect(error.message).toContain('2 declared side table finding(s)');
    expect(error.message).toContain(
      'foreign-key-not-cascade: module "acme_links" (package), table "acme_links_organization_refs" on organizations.Organization',
    );
    expect(error.message).toContain('make it on delete cascade');
    expect(error.message).toContain('table-missing: module "quote_requests" (core)');
    expect(error.message).toContain('run migrate up');
  });
});

describe('EntityExtensionLoaderOutputError', () => {
  it('names the module and host, and is a 500 (FR-057)', () => {
    const error = new EntityExtensionLoaderOutputError({
      moduleId: 'acme_erp',
      host: 'organizations.Organization',
      detail: 'value for "o-1" failed its schema: erpKey: expected string',
    });
    expect(error.name).toBe('EntityExtensionLoaderOutputError');
    expect(error.statusCode).toBe(500);
    expect(error.message).toContain('module "acme_erp"');
    expect(error.message).toContain('organizations.Organization');
    expect(error.message).toContain('erpKey');
  });
});
