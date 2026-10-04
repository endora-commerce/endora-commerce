---
"@endora-commerce/mod-newsletter": minor
---

Newsletter campaigns and automations render the e-mail blocks other modules contribute through `emailBlockRendererRegistry`, under the same rules as transactional e-mail: a switched-off module's block contributes nothing, and a renderer that throws is logged and does not stop the message. Adds the `pageBuilder.blockPreview.unavailable` string (English and Polish).
