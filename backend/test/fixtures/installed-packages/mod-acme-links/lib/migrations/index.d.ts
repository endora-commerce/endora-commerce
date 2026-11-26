import type { Migration } from '@mikro-orm/migrations';
export declare const migrations: ReadonlyArray<{ readonly name: string; readonly class: new (...args: never[]) => Migration }>;
