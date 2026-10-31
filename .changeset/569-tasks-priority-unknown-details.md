---
'@endora-commerce/mod-tasks': minor
---

`422 TASK_PRIORITY_UNKNOWN` now carries the unknown priority code as `details.priorityCode`; `details.code` no longer carries it, and the error has no `details.code` at all. The envelope read that value as a refusal token, looked up a sentence that could not exist and answered the thrower's English in every language. The message is now the translated sentence naming the code — `The priority "whenever" does not exist.` / `Priorytet „whenever” nie istnieje.` A client that read the code from `details.code` reads `details.priorityCode` instead.
