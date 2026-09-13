# The Settings-debt ledger

`specs/117-instance-bring-up/contracts/environment-inputs.md` §4, FR-004.

One shard per module, keyed by the variable's name. Every module-owned
environment input has an entry here saying **why it is not a Setting**, and the
entry is classified `bootstrap` or `configuration`.

`bootstrap` is a value the platform needs **before the settings store can be
read** — `SETTINGS_SECRET_ENCRYPTION_KEY` and `MFA_SECRET_ENCRYPTION_KEY` are the
standing examples, being the keys the store's own secrets are decrypted with.

`configuration` is a knob that belongs to the Settings module and is wearing an
environment variable. It is **not** an exemption: it is debt with an owner, and
the entry names the repair. This feature deliberately migrates none of them
(§4.4) — a migration is the owning module's own merge request, and several must
never move.

Two-way, and `check:env-inputs` enforces both directions: a declaration with no
entry is `module-input-without-a-settings-verdict`, an entry naming a variable
the module no longer declares is `stale-settings-verdict`. An entry whose reason
says nothing is not a verdict and is reported as the first. Delete a shard when
its last entry goes — an empty file is a done signal that says nothing, and the
loader refuses one.
