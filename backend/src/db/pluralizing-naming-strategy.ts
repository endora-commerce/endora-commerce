import { UnderscoreNamingStrategy } from '@mikro-orm/core';

/**
 * MikroORM naming strategy enforcing Principle VI of the constitution:
 *
 * - Table names: plural `snake_case` (e.g. `Product` → `products`, `ComponentRoleTime` →
 *   `component_role_times`).
 * - Columns: `snake_case` (inherited from UnderscoreNamingStrategy).
 * - Foreign keys: `{referenced_table_singular}_id` (e.g. `offer_id`, `user_id`).
 * - Join tables: `{a}_{b}` in plural form.
 *
 * Permitted singular-class exceptions: `Auth`, `Example`. Any class name matching these
 * exact PascalCase forms maps to the same lowercase snake_case without pluralization.
 *
 * See specs/001-b2b-platform-foundation/research.md R-04.
 */

const SINGULAR_EXCEPTIONS = new Set(['auth', 'example']);

export class PluralizingNamingStrategy extends UnderscoreNamingStrategy {
  override classToTableName(entityName: string): string {
    const snake = toSnakeCase(entityName);
    if (SINGULAR_EXCEPTIONS.has(snake)) {
      return snake;
    }
    return pluralize(snake);
  }

  override referenceColumnName(): string {
    // FK column base: keep plain `id`. The prefix is added by joinKeyColumnName below.
    return 'id';
  }

  override joinKeyColumnName(entityName: string, _referencedColumnName?: string): string {
    // Always produce `{referenced_table_singular}_id`, even if the class name is already singular.
    const singular = toSnakeCase(entityName);
    return `${singular}_id`;
  }

  override joinTableName(sourceEntity: string, targetEntity: string, propertyName: string): string {
    // Default behaviour, but with plural snake_case on both sides.
    const a = this.classToTableName(sourceEntity);
    const b = this.classToTableName(targetEntity);
    const prop = toSnakeCase(propertyName);
    return `${a}_${b}_${prop}`;
  }
}

/** PascalCase / camelCase → snake_case. */
export function toSnakeCase(input: string): string {
  return input
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

/**
 * Minimal English pluralizer. Covers the patterns we actually produce
 * (names ending in s/x/z/ch/sh/y/consonant-y). Good enough for the entity inventory in
 * data-model.md; a full inflector is YAGNI.
 */
export function pluralize(snake: string): string {
  if (snake.endsWith('s') || snake.endsWith('ch') || snake.endsWith('sh') || snake.endsWith('x') || snake.endsWith('z')) {
    return `${snake}es`;
  }
  if (snake.endsWith('y') && snake.length > 1 && !isVowel(snake[snake.length - 2] ?? '')) {
    return `${snake.slice(0, -1)}ies`;
  }
  return `${snake}s`;
}

function isVowel(ch: string): boolean {
  return ['a', 'e', 'i', 'o', 'u'].includes(ch);
}
