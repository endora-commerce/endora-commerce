import { describe, expectTypeOf, it } from 'vitest';
import type { AggregateCommandOptions, CustomFieldMerge } from './aggregate-ports.js';
import type {
  CreateProjectBody,
  CreateProjectCommentBody,
  CreateProjectLinkBody,
  ProjectCloseInput,
  ProjectCommandPort,
  ProjectMemberInput,
  ProjectRecord,
  ProjectUpdatePatch,
  UpdateProjectBody,
} from './projects.js';

/**
 * `specs/186-aggregate-ports/` T076 (issue #1828) — the Project aggregate
 * port's published shape: one method per operation of
 * `contracts/project-command-port.md`, each taking the admin body without its
 * version and ending in the aggregate ports' options; and the record carrying
 * the custom-field values (FR-015) and the two tokens `expectedVersion` names.
 */
describe('ProjectCommandPort (186 US7)', () => {
  it('declares the operations of the Project aggregate, and no archive or restore', () => {
    expectTypeOf<keyof ProjectCommandPort>().toEqualTypeOf<
      | 'create'
      | 'update'
      | 'setCustomFieldValues'
      | 'setOrganizations'
      | 'setMembers'
      | 'moveToStage'
      | 'close'
      | 'reopen'
      | 'link'
      | 'unlink'
      | 'addComment'
      | 'delete'
    >();
  });

  it('takes the admin bodies and ends every method in the aggregate ports’ options', () => {
    expectTypeOf<ProjectCommandPort['create']>().toEqualTypeOf<
      (input: CreateProjectBody, options?: AggregateCommandOptions) => Promise<ProjectRecord>
    >();
    expectTypeOf<ProjectCommandPort['setCustomFieldValues']>().toEqualTypeOf<
      (id: string, merge: CustomFieldMerge, options?: AggregateCommandOptions) => Promise<ProjectRecord>
    >();
    expectTypeOf<ProjectCommandPort['setOrganizations']>().toEqualTypeOf<
      (
        id: string,
        input: { readonly organizationIds: readonly string[] },
        options?: AggregateCommandOptions,
      ) => Promise<ProjectRecord | null>
    >();
    expectTypeOf<ProjectCommandPort['setMembers']>().toEqualTypeOf<
      (
        id: string,
        input: { readonly members: readonly ProjectMemberInput[] },
        options?: AggregateCommandOptions,
      ) => Promise<ProjectRecord>
    >();
    expectTypeOf<ProjectCommandPort['close']>().toEqualTypeOf<
      (id: string, input: ProjectCloseInput, options?: AggregateCommandOptions) => Promise<ProjectRecord>
    >();
    expectTypeOf<ProjectCommandPort['link']>().toEqualTypeOf<
      (id: string, input: CreateProjectLinkBody, options?: AggregateCommandOptions) => Promise<{ linkId: string }>
    >();
    expectTypeOf<ProjectCommandPort['addComment']>().toEqualTypeOf<
      (id: string, input: CreateProjectCommentBody, options?: AggregateCommandOptions) => Promise<{ commentId: string }>
    >();
  });

  it('updates the four fields of projects.project.update, never the version or the custom fields', () => {
    expectTypeOf<keyof ProjectUpdatePatch>().toEqualTypeOf<'title' | 'description' | 'value' | 'startOn'>();
    expectTypeOf<ProjectUpdatePatch['title']>().toEqualTypeOf<UpdateProjectBody['title']>();
  });

  it('carries the custom-field values and both concurrency tokens on the record', () => {
    expectTypeOf<ProjectRecord['customFieldValues']>().toEqualTypeOf<Record<string, unknown>>();
    expectTypeOf<ProjectRecord['version']>().toEqualTypeOf<number>();
    expectTypeOf<ProjectRecord['configurationVersion']>().toEqualTypeOf<number>();
  });
});
