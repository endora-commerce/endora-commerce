import type { z } from 'zod';
import type { ExtensibleHostTable } from '@endora-commerce/contracts';

/**
 * The declaration types of `defineColumnExtension`
 * (`specs/178-extensible-columns/contracts/column-extension-declaration.md` §1,
 * `data-model.md` §3).
 */

export type { ExtensibleHostTable } from '@endora-commerce/contracts';

/** Index request on one column. `'unique'` is a partial unique index and needs a nullable column. */
export type ColumnIndex = boolean | 'unique';

interface SpecBase {
  readonly nullable?: boolean;
  readonly index?: ColumnIndex;
}

/** `text`, `uuid`, `date` (YYYY-MM-DD) and `bigint` (decimal string) carry a string default. */
export interface StringColumnSpec extends SpecBase {
  readonly type: 'text' | 'uuid' | 'date' | 'bigint';
  readonly default?: string;
}
export interface BooleanColumnSpec extends SpecBase {
  readonly type: 'boolean';
  readonly default?: boolean;
}
export interface IntegerColumnSpec extends SpecBase {
  readonly type: 'smallint' | 'integer';
  readonly default?: number;
}
export interface VarcharColumnSpec extends SpecBase {
  readonly type: 'varchar';
  /** 1 – 1024. */
  readonly length: number;
  readonly default?: string;
}
export interface NumericColumnSpec extends SpecBase {
  readonly type: 'numeric';
  /** 1 – 38. */
  readonly precision: number;
  /** 0 – precision. */
  readonly scale: number;
  /** A decimal string. */
  readonly default?: string;
}
/** Always nullable, never defaulted (FR-004). */
export interface TimestamptzColumnSpec {
  readonly type: 'timestamptz';
  readonly nullable: true;
  readonly index?: ColumnIndex;
}
/** Always nullable, never indexed; `schema` validates the stored JSON on write and on read. */
export interface JsonbColumnSpec {
  readonly type: 'jsonb';
  readonly nullable: true;
  readonly schema: z.ZodType;
}

export type ColumnSpec =
  | StringColumnSpec
  | BooleanColumnSpec
  | IntegerColumnSpec
  | VarcharColumnSpec
  | NumericColumnSpec
  | TimestamptzColumnSpec
  | JsonbColumnSpec;

export type ColumnType = ColumnSpec['type'];

/** What a declaration is written as. */
export interface ColumnExtensionInput<
  H extends ExtensibleHostTable = ExtensibleHostTable,
  M extends string = string,
  C extends Record<string, ColumnSpec> = Record<string, ColumnSpec>,
> {
  readonly host: H;
  readonly module: M;
  readonly columns: C;
  /** Expose the columns on the host's admin reads under `?extensions=` (OD-178-5: opt-in). */
  readonly adminReads?: boolean;
}

/** The brand that tells a platform-made declaration from a look-alike object. */
export declare const columnExtensionBrand: unique symbol;

/** A frozen, validated declaration — what `defineColumnExtension` returns. */
export interface ColumnExtension<
  H extends ExtensibleHostTable = ExtensibleHostTable,
  M extends string = string,
  C extends Record<string, ColumnSpec> = Record<string, ColumnSpec>,
> {
  readonly host: H;
  readonly module: M;
  readonly columns: Readonly<C>;
  readonly adminReads: boolean;
  /** `<module>:<host>` — unique per platform (V11). */
  readonly id: `${M}:${H}`;
  readonly [columnExtensionBrand]: true;
}

type BaseValue<S> = S extends { readonly type: 'jsonb'; readonly schema: infer Z extends z.ZodType }
  ? z.infer<Z>
  : S extends { readonly type: 'timestamptz' }
    ? Date
    : S extends { readonly type: 'boolean' }
      ? boolean
      : S extends { readonly type: 'smallint' | 'integer' }
        ? number
        : S extends { readonly type: 'text' | 'varchar' | 'bigint' | 'numeric' | 'date' | 'uuid' }
          ? string
          : never;

/** The value one column holds: its type, plus `null` when nullable (`data-model.md` §3). */
export type ColumnValue<S> = S extends { readonly nullable: true } ? BaseValue<S> | null : BaseValue<S>;

type ColumnsOf<D> = D extends ColumnExtension<ExtensibleHostTable, string, infer C> ? C : never;

/** Every declared key and its value. */
export type ColumnExtensionValues<D> = {
  -readonly [K in keyof ColumnsOf<D>]: ColumnValue<ColumnsOf<D>[K]>;
};

/** A write: any subset of the declared keys. */
export type ColumnExtensionPatch<D> = Partial<ColumnExtensionValues<D>>;

/** A JSON literal in the normalised spec. */
export type SpecLiteral = string | number | boolean | null;

/**
 * The normalised column spec (`data-model.md` §3): fixed key order, the
 * ledger's `spec` and the hash input. `jsonb`'s `schema` is not part of it.
 */
export interface NormalisedColumnSpec {
  readonly type: ColumnType;
  readonly length?: number;
  readonly precision?: number;
  readonly scale?: number;
  readonly nullable: boolean;
  readonly default: SpecLiteral;
  readonly index: ColumnIndex;
}

/** One declared column, resolved to its physical names. */
export interface ResolvedColumn {
  readonly key: string;
  readonly physicalName: string;
  readonly spec: NormalisedColumnSpec;
  /** The index name, when `spec.index` is not `false`. */
  readonly indexName: string | null;
  /** The declared Zod schema of a `jsonb` column. */
  readonly jsonSchema: z.ZodType | null;
}

/** A declaration with everything the platform derives from it. */
export interface ResolvedColumnExtension {
  readonly declaration: ColumnExtension;
  readonly host: string;
  readonly module: string;
  readonly columns: readonly ResolvedColumn[];
}
