---
'@endora-commerce/cli': minor
---

`endora install` asks, at a terminal, what its flags did not answer: the directory (recommending `./endora-commerce`), which parts to write (a checklist over the instance's members and the storefront), whether to start the development services, whether to seed demo data (no default: Enter asks again), and the administrator's e-mail, password (not echoed) and name. Every question has a flag, and with `--non-interactive`, `--dry-run`, a CI marker or no terminal on either descriptor it asks nothing — a missing answer, the directory now included, is one refusal naming every flag still owed. Each run prints an `[answers]` line (`flags=`, `prompted=`, `recommended=`, `defaulted=0`) and the closing block names every recommendation taken with what reverses it.

`endora new instance` and `endora install` accept `--without <member>` (repeatable; `admin` or `docs`), which writes the instance without that member while keeping the same module list. `--without backend` and a name that is not a member (including `storefront`, which `--no-storefront` leaves out of `install`) are refused before anything is written. The vocabulary is exported as `MEMBER_VOCABULARY` beside `memberRefusal`.
