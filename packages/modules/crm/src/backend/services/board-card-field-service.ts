import { z } from 'zod';
import {
  ERROR_CODES,
  OPPORTUNITY_BOARD_CARD_MAX_FIELDS,
  type CustomFieldDefinitionReadPort,
  type OpportunityBoardCardConfig,
  type OpportunityBoardCardField,
  type SettingsAdminPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import { CRM_SETTING_CODES } from '../../manifest.js';
import {
  builtinBoardCardFields,
  customBoardCardField,
  namesCustomBoardField,
  resolveBoardCardFields,
  storedBoardCardFieldRefs,
} from '../domain/board-card-fields.js';
import { actingAdminUserId } from './opportunity-assignment-service.js';

export interface BoardCardFieldServiceDeps {
  /** Ports of other modules — lazy, resolved per call, never captured. */
  settings: SettingsReadPort;
  settingsAdmin: SettingsAdminPort;
  definitions: CustomFieldDefinitionReadPort;
  /** Whether `quote_requests` is present: its link count is offered only then. */
  quoteRequestsPresent: () => boolean;
}

/** Anything: what the stored value means is decided by `storedBoardCardFieldRefs`. */
const STORED = z.unknown();

/**
 * Which fields a board card shows
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §12c, User Story
 * 19 — FR-090, FR-093).
 *
 * The choice is one Setting, `crm.board_card_fields`: an ordered list of field
 * references, platform-wide. It is written through `settings`' own audited
 * write and read through the kernel's settings port, so it has the cache, the
 * audit entry and the place on the Settings screen every other setting has.
 *
 * **A reference is resolved every time it is read.** A custom field whose
 * definition is gone resolves to nothing and drops out — of the card, of the
 * filters and of what is offered — and the stored list is left as it is until
 * somebody saves the card again.
 */
export class BoardCardFieldService {
  constructor(private readonly deps: BoardCardFieldServiceDeps) {}

  /** The fields the card shows, in order — what the board renders and filters by. */
  async selected(): Promise<OpportunityBoardCardField[]> {
    const refs = await this.#storedRefs();
    // A card of built-in fields alone asks `custom_fields` nothing.
    return resolveBoardCardFields(refs, await this.#offered(namesCustomBoardField(refs)));
  }

  async config(): Promise<OpportunityBoardCardConfig> {
    const [refs, available] = await Promise.all([this.#storedRefs(), this.#offered(true)]);
    return {
      fields: resolveBoardCardFields(refs, available),
      available,
      maxFields: OPPORTUNITY_BOARD_CARD_MAX_FIELDS,
    };
  }

  /** Store the choice. Every reference must be one that is offered now. */
  async set(refs: readonly string[]): Promise<OpportunityBoardCardConfig> {
    const offered = new Set((await this.#offered(true)).map((field) => field.ref));
    const unknown = refs.filter((ref) => !offered.has(ref));
    if (unknown.length > 0) {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'A board card cannot show a field that does not exist.',
        unknown.map((ref) => ({ path: 'fields', issue: `Unknown field: ${ref}` })),
      );
    }
    await this.deps.settingsAdmin.setValueForAllChannels(CRM_SETTING_CODES.BOARD_CARD_FIELDS, [...refs], null, {
      actorAdminUserId: actingAdminUserId(),
    });
    return this.config();
  }

  async #storedRefs(): Promise<string[]> {
    return storedBoardCardFieldRefs(
      await this.deps.settings.get(CRM_SETTING_CODES.BOARD_CARD_FIELDS, null, STORED),
    );
  }

  async #offered(withCustom: boolean): Promise<OpportunityBoardCardField[]> {
    const builtin = builtinBoardCardFields(this.deps.quoteRequestsPresent());
    if (!withCustom) return builtin;
    const definitions = await this.deps.definitions.listForEntity('opportunity');
    return [
      ...builtin,
      ...[...definitions]
        .sort(
          (a, b) =>
            a.definition.sortOrder - b.definition.sortOrder || a.definition.key.localeCompare(b.definition.key),
        )
        .map(customBoardCardField),
    ];
  }
}
