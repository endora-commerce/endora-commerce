---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-crm': minor
---

An operator chooses which fields a card on the Opportunity board shows, and the board is
filtered by the fields its cards show. Additive: an instance nobody configures shows the card
it showed before.

**`@endora-commerce/mod-crm`.** A new Setting, `crm.board_card_fields` — a JSON array of field
references, platform-wide, defaulting to the card as it was (`builtin:number`,
`builtin:organization`, `builtin:value`, `builtin:assignee`, `builtin:tags`). It is edited in
the new *Board card* section of **CRM → Workflow**, which the board links to for a holder of
`crm:configure`. A field is `builtin:<key>` or `custom:<definition key>`; a custom field
whose definition is deleted drops out of the cards, the filters and the section without an
error. At most six fields are shown, the title besides.

- `GET /api/v1/admin/crm/board/card-fields` (`crm:read`) answers `{ fields, available,
  maxFields }`; `PUT` on the same path (`crm:configure`) takes `{ fields: string[] }` and
  answers the same.
- `GET /api/v1/admin/crm/board` answers `cardFields` beside `columns`, and every card carries
  `cardValues` — the values of the chosen fields a summary does not already hold, keyed by
  reference, and of no other field.
- `GET /api/v1/admin/crm/board` and `GET /api/v1/admin/crm/opportunities` accept
  `fieldFilters`, a URL-encoded JSON object of operators per field reference (`contains`,
  `in`, `is`, `min`, `max`, `from`, `to`). A reference that is not on the card is ignored. The
  list also accepts `cardValues=true`.
- The board's filters are now carried in its address (`/crm/board?assignee=me&f.custom:lead_source.in=referral`),
  so a filtered board can be reloaded and shared.

The module now resolves two more ports, both of owners it already depends on:
`customFieldDefinitionReadPort` (`custom_fields`) and `settingsAdminService` (`settings`).

**`@endora-commerce/contracts`.** New exports: `OPPORTUNITY_BOARD_CARD_MAX_FIELDS`,
`OPPORTUNITY_BOARD_BUILTIN_FIELD_KEYS`, `OPPORTUNITY_BOARD_DEFAULT_CARD_FIELDS`,
`opportunityBoardFieldRefSchema`, `opportunityBoardFieldKindSchema`,
`OpportunityBoardCardFieldSchema`, `SetOpportunityBoardCardFieldsRequestSchema`,
`OpportunityBoardCardConfigSchema` (and its response envelope), `OpportunityFieldFilterSchema`,
`OpportunityFieldFiltersSchema` and their inferred types. `OpportunityBoardSchema` gains the
required member `cardFields`; `OpportunitySummarySchema` gains the optional `cardValues`;
`OpportunityListQuerySchema` and `OpportunityBoardQuerySchema` gain the optional `fieldFilters`
(parsed from its JSON text) and the list query the optional `cardValues`.
