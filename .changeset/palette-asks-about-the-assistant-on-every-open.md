---
'@endora-commerce/admin-shell': patch
'@endora-commerce/mod-prompt-actions': patch
---

The command palette offers the AI assistant as soon as it is configured, without a page reload.
The palette asked the backend whether the assistant was available once per page session and kept
that answer, so an operator who had opened the palette before enabling the assistant and attaching
credentials in Settings was shown the pre-save state — no **Ask the assistant…** row — until the
page was reloaded, while the backend had reported `ready` from the first read after the save. The
same remembered answer kept the row offered after the assistant was switched off, where every
prompt then answered `409`. The palette now asks each time it is opened, paints the last known
answer meanwhile, and withdraws the row when the question fails.

The module's documentation page described three settings that do not exist
(`prompt_actions.provider`, `prompt_actions.model`, `prompt_actions.api_key`). It now describes the
ones that do: the provider, model and API key come from an `llm` credential configuration
referenced by `prompt_actions.llm_credentials`.

No API, setting or permission changes.
