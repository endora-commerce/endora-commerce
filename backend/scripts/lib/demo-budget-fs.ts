/**
 * The four filesystem questions `check-demo-data-budget.ts` asks, injected.
 *
 * A module of its own rather than a member of the check, for the reason
 * `bundle-pairing.ts` gives about its own reader: it exists so a caller
 * measuring a tree it does not own can supply one without the analysis learning
 * about that caller. The red proofs do **not** use it — they build a real module
 * tree on disk and let the walk run over it, because a fixture that hands in a
 * reader proves the classifier and leaves the walk that feeds it unproven
 * (issue #130).
 *
 * `readDirectory` answers `null` for a directory that is not there rather than
 * throwing or returning `[]`, and the difference is load-bearing: an empty
 * directory and an absent one are two states, and the check's
 * `unlocatable-demo-layer` finding is about the second.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';

/** One entry of a directory listing, with the two kinds the walk branches on. */
export interface DemoBudgetDirent {
  readonly name: string;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
}

export interface DemoBudgetFs {
  readonly isDirectory: (path: string) => boolean;
  /** `null` when the path is not a directory — never an empty listing. */
  readonly readDirectory: (path: string) => readonly DemoBudgetDirent[] | null;
  /** `null` when the file cannot be read. */
  readonly readFile: (path: string) => string | null;
  /** Size in bytes, or `null` when the file is not there. */
  readonly sizeOf: (path: string) => number | null;
}

export const nodeDemoBudgetFs: DemoBudgetFs = {
  isDirectory: (path) => {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
  readDirectory: (path) => {
    let entries: DemoBudgetDirent[];
    try {
      entries = readdirSync(path, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        isFile: entry.isFile(),
        isDirectory: entry.isDirectory(),
      }));
    } catch {
      return null;
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  },
  readFile: (path) => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  },
  sizeOf: (path) => {
    try {
      return statSync(path).size;
    } catch {
      return null;
    }
  },
};
