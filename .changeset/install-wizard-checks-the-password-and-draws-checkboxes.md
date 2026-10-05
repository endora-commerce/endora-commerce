---
'@endora-commerce/cli': patch
---

Two things about the questions `endora install` — and so `npx create-endora-commerce` — asks at a
terminal.

- **The administrator password is checked when it is given.** An instance refuses a password
  shorter than 12 characters, and the installer used to find that out at the step that creates the
  account — after the tree was written, the packages installed and the database migrated — so a
  short password cost the whole run. The wizard now says so and asks again at once, and a short
  `--admin-password` is refused with the other preconditions, before anything is written.
- **The parts are checkboxes.** Where the terminal can redraw, the *Which parts should this machine
  run?* list is moved through with the arrow keys, toggled with Space and accepted with Enter,
  instead of by typing row numbers. A terminal that cannot move its cursor (`TERM=dumb`) and input
  that is not a terminal keep the numbered list; every flag answers what it answered before.
