import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  EntityExtensionReadOptions,
  TaskContextQuery,
  TaskReadPort,
  TaskRecord,
  TaskSearchQuery,
  WithEntityExtensions,
} from '@endora-commerce/contracts';
import { lazyEntityExtensionReads, type EntityExtensionReads } from '@endora-commerce/platform/kernel';
import type { TaskService } from './task-service.js';

/** The host name side-table loaders register against (`specs/187-side-table-extensions/`). */
const HOST = 'tasks.Task';

type Extended = WithEntityExtensions<TaskRecord>;

/**
 * `taskReadPort` — reading Tasks from another module
 * (`specs/165-task-management/contracts/ports-and-events.md` §1).
 *
 * Every answer goes through the service's visibility-checked reads: an
 * administrator's call is narrowed by context visibility (163 research R-9) and
 * by the draft/private rule (165 R-3), so another admin's private Task is
 * absent from CRM's and Projects' references; a call the system makes is not
 * narrowed. Published with `providePort`, so a consumer resolving it while
 * `tasks` is off gets `ModuleDisabledError`.
 *
 * **Extensions after visibility.** `findById`, `findByIds`, `search`,
 * `listInContext` and `listOpenInContext` take `options.include`
 * (`specs/187-side-table-extensions/` FR-058): the Tasks the visibility-checked
 * read returned, and no other, are handed — on the entity manager the service
 * reads with — to the platform's `entityExtensionReads`. Without `include`
 * nothing is resolved.
 */
export class TaskReadPortService implements TaskReadPort {
  constructor(
    private readonly tasks: TaskService,
    /** The factory `TaskService` reads with (`TaskServiceDeps.emFactory`). */
    private readonly emFactory: () => EntityManager,
    /** The kernel's `entityExtensionReads`; absent in a hand-built service, which has no loader to offer. */
    private readonly extensionReads: EntityExtensionReads = lazyEntityExtensionReads(() => undefined),
  ) {}

  async findById(id: string, options?: EntityExtensionReadOptions): Promise<Extended | null> {
    const row = await this.tasks.findVisibleRow(id);
    if (!row) return null;
    const [record] = await this.#attach(await this.tasks.records([row]), options);
    return record ?? null;
  }

  async findByIds(ids: readonly string[], options?: EntityExtensionReadOptions): Promise<Extended[]> {
    return this.#attach(await this.tasks.records(await this.tasks.visibleRowsByIds(ids)), options);
  }

  async search(query: TaskSearchQuery, options?: EntityExtensionReadOptions): Promise<Extended[]> {
    return this.#attach(await this.tasks.records(await this.tasks.searchVisibleRows(query.q, query.limit)), options);
  }

  async listInContext(q: TaskContextQuery, options?: EntityExtensionReadOptions): Promise<Extended[]> {
    return this.#attach(await this.tasks.records(await this.tasks.rowsInContext(q, { openOnly: false })), options);
  }

  /** Not closed and not a draft — the completion gate's question (R-1, R-3). */
  async listOpenInContext(q: TaskContextQuery, options?: EntityExtensionReadOptions): Promise<Extended[]> {
    return this.#attach(await this.tasks.records(await this.tasks.rowsInContext(q, { openOnly: true })), options);
  }

  countInContext(q: TaskContextQuery): Promise<number> {
    return this.tasks.countInContext(q);
  }

  async #attach(records: TaskRecord[], options: EntityExtensionReadOptions | undefined): Promise<Extended[]> {
    return [...(await this.extensionReads.attach(HOST, records, options, this.emFactory()))];
  }
}
