#!/usr/bin/env bash
# scripts/check-naming.sh — enforces Principle VI of the constitution (naming conventions).
#
# What it checks:
#   1. Backend module folders are plural snake_case.
#   2. MikroORM migration source code does not declare PascalCase or camelCase
#      table / column names (we want snake_case).
#   3. JSON literal keys inside Zod contracts and route bodies are camelCase.
#   4. URL path segments inside Fastify route registrations are kebab-case.
#   5. A migration class name is scoped by its owning module — the tail after
#      `Migration<STAMP>` begins with the PascalCase form of the module's
#      segment (feature 081, contracts/migration-identity.md §2).
#
# Modes:
#   --diff          scan only files changed against $BASE_REF (defaults to origin/master).
#                   Used by CI on merge requests; faster + actionable.
#   (no flag)       full-tree scan. Used locally and by the `master` branch CI.
#
# Where the modules are: **resolved, not spelled** (feature 080, T012), and
# since T040a resolved as a **list**. See `lib/module-root.sh`: the generated
# manifest index says which modules exist, each module's own directory is the
# ancestor of a `manifest.ts` named after one of them, a repository without an
# index is exit 2, and every rule below iterates `${module_dirs[@]}` rather than
# globbing one root. That is what lets a module leave `backend/src/modules` for
# a package of its own without these rules quietly stopping at the old address.
# A checkout nested inside this one — a `git worktree` created under the
# repository directory, as every agent here works in — is another commit of the
# same repository and is pruned from both the resolution and the listing.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=scripts/lib/read-size.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/read-size.sh"
# shellcheck source=scripts/lib/module-root.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/module-root.sh"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }

mode="full"
if [[ "${1:-}" == "--diff" ]]; then
  mode="diff"
fi

base_ref="${BASE_REF:-origin/master}"

# The file list comes from git. Without it every `git ls-files` below returns
# nothing and the script would exit 0 having checked NOTHING — a false green is
# worse than no check, so bail loudly instead.
if ! command -v git >/dev/null 2>&1 || ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  red "✗ check-naming needs git and a git work tree (the file list comes from git ls-files)."
  exit 2
fi

# Build the file list. In --diff mode we use the changed-files set against $BASE_REF;
# fall back to a full-tree scan if the base ref isn't fetched.
if [[ "$mode" == "diff" ]] && git rev-parse --verify --quiet "$base_ref" >/dev/null; then
  listing="diff"
else
  listing="full"
fi

list_files() {
  if [[ "$listing" == "diff" ]]; then
    git diff --name-only --diff-filter=ACMR "$base_ref"...HEAD
  else
    git ls-files --cached --others --exclude-standard
  fi
}

# Resolved once, at the top level: two of the walks below consult it, a pipeline
# stage runs in a subshell, and a second scan is a second chance to disagree
# with the first.
module_root_resolve_nested_checkouts

# A nested checkout is another commit of this same repository, so its paths are
# not this listing's (see `lib/module-root.sh` for the discriminator).
#
# The listing needs the filter as much as the resolution does, and for a reason
# that is easy to measure wrong. `git ls-files --others` reports a nested work
# tree whose gitfile resolves as a **single directory entry**, and one whose
# gitdir has been swept away **file by file** — so the same directory is a
# handful of phantom entries in the count or a whole second tree in it,
# depending on housekeeping nobody performed deliberately. On the machine this
# was written on neither happens, because an untracked `.git/info/exclude` rule
# hides `.claude/worktrees` from git and from nothing else: that rule is why
# this script's sibling kept printing a correct `files=` while this one could
# not resolve its root at all. A count that depends on a file no clone carries
# is a count that means one thing here and another there, which is what stops a
# recorded read size being worth recording (issue #248).
mapfile -t changed_files < <(list_files \
  | grep -Ev '^(node_modules/|dist/|build/|\.next/|\.docusaurus/|pnpm-lock\.yaml|package-lock\.json)' \
  | module_root_drop_nested_checkouts || true)

# A full-tree listing that comes back empty is a broken listing, not a clean
# repository: every rule below iterates this array, so all four would report
# nothing and the script would exit 0 having read no file at all. In --diff mode
# an empty list is the ordinary "this MR touched nothing in scope".
if [[ "$listing" == "full" ]] && [ "${#changed_files[@]}" -eq 0 ]; then
  red "✗ check-naming listed no files — refusing to report a vacuous pass."
  exit 2
fi

# ...and a listing that is merely non-empty is not enough (issue #215). Three of
# the five rules read the module tree off the **filesystem** rather than off the
# listing, and 93% of this repository lives there: with that directory moved the
# three iterate nothing, the other two report on the remaining files, and the
# script exits 0 having judged no module at all. Measured: it did exactly that.
#
# So the modules are resolved rather than spelled (feature 080, T012, T040a).
# The generated manifest index says which ones exist and each module's directory
# is resolved from it, so a layout move is followed instead of reported clean at
# the old address. A repository where the index does not resolve is refused; one
# where it resolves twice is refused as well, because picking one would narrow
# the scan to it in silence.
index_status=0
manifest_index="$(module_root_manifest_index)" || index_status=$?
if [ "$index_status" -ne 0 ]; then
  case "$index_status" in
    2)
      red "✗ check-naming found more than one generated manifest index:"
      printf '%s\n' "$manifest_index" | sed 's/^/    /'
      red "  The module root is whichever one it picked, so the five rules below would judge"
      red "  one tree and report on the repository. Refusing to guess."
      ;;
    *)
      red "✗ check-naming found no generated manifest index in this repository, so it cannot"
      red "  tell where the backend modules live. Three of its five rules walk that tree and"
      red "  would judge nothing while the other two reported clean."
      red "  Refusing to report a vacuous pass."
      ;;
  esac
  exit 2
fi
# The application's own source root, resolved from where the index sits, and
# the core migration directory inside it. `db/migrations` stays spelled: it is
# the application's own schema directory rather than a module's, and it is not
# what moves when a module becomes a package.
source_root="$(module_root_source_root "$manifest_index")"
core_migrations_dir="$source_root/db/migrations"

module_dirs=()
while IFS= read -r module_dir; do
  [ -n "$module_dir" ] && module_dirs+=("$module_dir")
done < <(module_root_module_directories "$manifest_index" || true)

# Rule 1 judges *names*, so its population is every directory that sits where a
# module sits — not the modules the index registers. A folder that is misnamed,
# or that has not been through `composer:generate` yet, is the one the rule
# exists to catch and is the one the index does not list.
module_folders=()
while IFS= read -r module_folder; do
  [ -n "$module_folder" ] && module_folders+=("$module_folder")
done < <(module_root_module_folders "$manifest_index" || true)

# The index resolves; the modules it registers must also be somewhere. This is
# the weaker of the two floors — the listing reconciliation below passes on
# nothing a half-moved tree can hide — but it fires before any rule runs, and its
# message names the tree rather than the listing.
if [ "${#module_dirs[@]}" -eq 0 ]; then
  red "✗ check-naming resolved no module directory from $manifest_index — the module"
  red "  folder and migration-identifier rules would judge nothing while the rest"
  red "  reported clean. Refusing to report a vacuous pass."
  exit 2
fi

# What was read, beside what was found (issue #244). Four rules print a verdict
# and none of them printed an input size, so a full-mode run that judged three
# files and a full-mode run that judged three thousand ended in the same green
# tick. In full mode the listing is corroborated against the generated manifest
# index — every registered module must contribute at least one file — which is
# the same floor `scripts/lib/module-population.ts` gives the tsx checks, and
# strictly stronger than the `module_dir_count > 0` test above: that one passes
# on a half-moved tree. In --diff mode the population is the merge request, so
# there is nothing to derive an expectation from and the token says so.
if [[ "$listing" == "full" ]]; then
  if ! naming_coverage="$(printf '%s\n' "${changed_files[@]}" \
    | read_size_module_coverage "$(printf '%s\n' "${module_dirs[@]}")")"; then
    red "✗ check-naming could not reconcile the listing against the modules resolved from"
    red "  $manifest_index — the expected population is derived from them, so there is"
    red "  nothing to compare the listing against. Refusing to report a vacuous pass."
    exit 2
  fi
  read_size_report '[naming]' "${#changed_files[@]}" - "manifest-index:$naming_coverage"
else
  # A --diff run's population is the merge request, so there is nothing to
  # derive an expectation from and an empty one is the ordinary "this merge
  # request touched nothing in scope" — the line is printed, the zero is not
  # refused.
  read_size_line '[naming]' "${#changed_files[@]}" - self-reported
fi

fail=0

# ──────────────────────────────────────────────────────────────────────────
# 1. Backend module folder shape.
# Plural snake_case, with two explicit allow-lists:
#
#   * singular-mass nouns and single named surfaces whose plural forms read
#     worse than the singular (catalog, inventory, search, auth, example,
#     email — service modules; quick_order, megamenu, assets_library, blog,
#     newsletter — one named user surface rather than a collection);
#   * proper nouns — vendor product names and standard/protocol acronyms
#     (google_tag_manager, stripe, ksef). These are never pluralised in any
#     language, and the folder name is load-bearing (manifest ids, migration
#     registry keys, i18n bundle paths, `@core/*` overlay aliases), so
#     renaming them is not an option.
#
# Infrastructure modules carry a leading underscore (`_i18n`, `_lifecycle`)
# to sort first and to mark "cross-cutting, not a domain" — see AGENTS.md.
# ──────────────────────────────────────────────────────────────────────────
allowed_singular="^(auth|catalog|email|example|import_export|inventory|quick_order|search|seo|assets_library|blog|megamenu|newsletter)$"
allowed_proper_noun="^(autopay|dhl_parcel|google_tag_manager|inpost|ksef|mfa|paypal|payu|pim_akeneo|pim_connector|pim_ergonode|pim_pimcore|pim_unopim|pwa|stripe|tpay)$"

for dir in "${module_folders[@]}"; do
  name="$(basename "$dir")"
  [ -d "$dir" ] || continue
  if [[ ! "$name" =~ ^_?[a-z][a-z0-9_]*$ ]]; then
    red "✗ Invalid backend module folder casing: $dir (must be snake_case)"
    fail=1
    continue
  fi
  # Cross-cutting infrastructure module — exempt from the plural rule.
  if [[ "$name" == _* ]]; then
    continue
  fi
  if [[ "$name" =~ $allowed_singular ]] || [[ "$name" =~ $allowed_proper_noun ]]; then
    continue
  fi
  if [[ ! "$name" =~ (s|ies|ches|shes|xes|zes)$ ]]; then
    red "✗ Backend module folder looks singular: $dir"
    red "  Principle VI requires plural snake_case. Allowed singular exceptions: ${allowed_singular//[()^$]/}"
    red "  Allowed proper nouns: ${allowed_proper_noun//[()^$]/}"
    fail=1
  fi
done

# ──────────────────────────────────────────────────────────────────────────
# 2. Migration files — flag PascalCase/camelCase table or column literals.
# Heuristic: any quoted string passed to createTable/dropTable/addColumn etc.
# whose first character is uppercase or contains a hump.
# ──────────────────────────────────────────────────────────────────────────
migration_files=()
for f in "${changed_files[@]}"; do
  for dir in "${module_dirs[@]}"; do
    if [[ "$f" == "$dir"/*/migrations/*.ts ]] || [[ "$f" == "$dir"/migrations/*.ts ]]; then
      migration_files+=("$f")
      break
    fi
  done
done
# In full mode, also scan all migrations regardless of diff selection so a
# silent regression on `main` is caught.
if [[ "$mode" == "full" ]]; then
  while IFS= read -r f; do migration_files+=("$f"); done < <(
    find "${module_dirs[@]}" -path '*/migrations/*.ts' 2>/dev/null
  )
fi
# de-duplicate
if [ "${#migration_files[@]}" -gt 0 ]; then
  mapfile -t migration_files < <(printf '%s\n' "${migration_files[@]}" | sort -u)
fi

for f in "${migration_files[@]}"; do
  [ -f "$f" ] || continue
  # createTable("Foo") / table.string("orderItemId") — flag uppercase letters in
  # the identifier. The greedy [A-Z] match is enough; a false positive would
  # be a string in the SQL body, which is rare for these helper calls.
  if grep -nP "(createTable|dropTable|addColumn|alterTable)\(\s*['\"][^'\"]*[A-Z]" "$f" >/dev/null 2>&1; then
    red "✗ Migration $f references a non-snake_case identifier:"
    grep -nP "(createTable|dropTable|addColumn|alterTable)\(\s*['\"][^'\"]*[A-Z]" "$f" | sed 's/^/    /'
    fail=1
  fi
done

# ──────────────────────────────────────────────────────────────────────────
# 3. JSON keys in Zod contracts must be camelCase.
# We look at packages/contracts/src/*.ts for object literals like
# `{ snake_case: ... }` or `{ PascalCase: ... }` keyed in a z.object call.
# Heuristic — picks up multi-word identifiers with a leading uppercase or
# embedded underscore.
#
# Not every z.object() describes an HTTP boundary. Some model a payload that
# is persisted verbatim (a JSONB envelope with a SQL column default, an
# external vendor's wire format) where the key is fixed by stored data, not
# by our API style, and renaming it would need a data migration. Mark those
# with `naming:allow-snake-case` in a comment on or directly above the field,
# stating why — the marker covers exactly the next field declaration.
# ──────────────────────────────────────────────────────────────────────────
contract_files=()
for f in "${changed_files[@]}"; do
  if [[ "$f" == packages/contracts/src/*.ts ]]; then
    contract_files+=("$f")
  fi
done
if [[ "$mode" == "full" ]]; then
  while IFS= read -r f; do contract_files+=("$f"); done < <(
    find packages/contracts/src -name '*.ts' 2>/dev/null
  )
fi
if [ "${#contract_files[@]}" -gt 0 ]; then
  mapfile -t contract_files < <(printf '%s\n' "${contract_files[@]}" | sort -u)
fi

for f in "${contract_files[@]}"; do
  [ -f "$f" ] || continue
  # Inside z.object({ ... }) match a `foo_bar: ...` or `Foo: ...` field declaration.
  # Skip lines that are clearly comments. Allow underscore in well-known meta
  # fields like `'application/json'` keys, which are quoted (pattern: '…').
  # POSIX awk only — the CI image ships mawk, not gawk, so no 3-argument
  # match() and no \s / non-greedy PCRE constructs.
  matches=$(awk -v fname="$f" '
    /z\.object\([ \t]*\{/ { inblock=1 }
    inblock {
      # An opt-out marker arms the exemption for the next field declaration.
      if ($0 ~ /naming:allow-snake-case/) { allow=1; next }
      if ($0 ~ /^[ \t]*([A-Z][A-Za-z0-9]*|[a-z][a-zA-Z0-9]*_[A-Za-z0-9_]+)[ \t]*:/) {
        if (allow) { allow=0 } else { print fname":"NR":"$0 }
      } else if ($0 ~ /[^ \t]/ && $0 !~ /^[ \t]*(\/\/|\*|\/\*)/) {
        # Any other line of real code disarms a dangling marker.
        allow=0
      }
      if ($0 ~ /\}\)/) inblock=0
    }
  ' "$f" || true)
  if [ -n "$matches" ]; then
    red "✗ Non-camelCase Zod field key in $f:"
    echo "$matches" | sed 's/^/    /'
    fail=1
  fi
done

# ──────────────────────────────────────────────────────────────────────────
# 4. URL path segments — kebab-case in Fastify route declarations.
# Reads route registrations like `app.get('/api/v1/foo/bar', ...)`.
# Allowed:
#   - kebab-case ascii segments
#   - segment params `:foo`
#   - leading-underscore segments (e.g. /_health, /_openapi.json, /_test/*) —
#     internal/diagnostic convention.
#
# A **test file is not a route declaration** (feature 106). The population is
# matched on the filename — anything holding `routes` — and a module package's
# harness-free tests now sit beside the sources they cover, so
# `currency-routes-ports.test.ts` and `i18n-routes-currency-ports.test.ts`
# joined it by being named after their subject. What they hold is a *request*:
# `app.inject({ url: '/api/v1/admin/currencies/XAA' })`, where `XAA` is ISO
# 4217's reserved test code and is uppercase because the currency it stands for
# is. The rule judges what a module declares, so a caller is out of its
# population; a genuine route declared in a `.test.ts` would be a different
# defect, and one no naming rule can see.
# ──────────────────────────────────────────────────────────────────────────
route_files=()
for f in "${changed_files[@]}"; do
  [[ "$f" == *.test.ts ]] && continue
  if [[ "$f" == "$source_root"/*routes*.ts ]] || [[ "$f" == "$source_root"/*/routes*.ts ]]; then
    route_files+=("$f")
    continue
  fi
  for dir in "${module_dirs[@]}"; do
    if [[ "$f" == "$dir"/*routes*.ts ]]; then
      route_files+=("$f")
      break
    fi
  done
done
if [[ "$mode" == "full" ]]; then
  while IFS= read -r f; do route_files+=("$f"); done < <(
    find "$source_root" "${module_dirs[@]}" -name 'routes*.ts' ! -name '*.test.ts' 2>/dev/null
  )
fi
if [ "${#route_files[@]}" -gt 0 ]; then
  mapfile -t route_files < <(printf '%s\n' "${route_files[@]}" | sort -u)
fi

for f in "${route_files[@]}"; do
  [ -f "$f" ] || continue
  # Pull every quoted string that starts with `/api/v1/`. For each segment,
  # verify it matches an allowed shape.
  while IFS= read -r line; do
    [[ "$line" =~ \"(/api/v1/[^\"]+)\" ]] || [[ "$line" =~ \'(/api/v1/[^\']+)\' ]] || continue
    path="${BASH_REMATCH[1]}"
    IFS='/' read -ra segments <<< "$path"
    for seg in "${segments[@]}"; do
      [ -n "$seg" ] || continue
      # Allowed shapes:
      #   - empty (leading /)
      #   - `:param`
      #   - `*` glob (Fastify catch-all)
      #   - leading-underscore internal/diagnostic prefix (e.g. _health, _openapi.json, _test)
      #   - kebab-case lower (letters/digits, words separated by '-')
      if [[ "$seg" =~ ^: ]]; then continue; fi
      if [[ "$seg" == "*" ]]; then continue; fi
      if [[ "$seg" =~ ^_[a-z0-9][a-z0-9.-]*$ ]]; then continue; fi
      if [[ "$seg" =~ ^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+)*$ ]]; then continue; fi
      red "✗ Non-kebab-case URL segment '$seg' in $f → $path"
      fail=1
    done
  done < <(grep -nE "['\"]/api/v1/" "$f" || true)
done

# ──────────────────────────────────────────────────────────────────────────
# 5. Migration class names are module-scoped.
#
# `Migration<STAMP><Tail>` and `<Tail>` must begin with the PascalCase form of
# the owning module's segment (`_i18n` → `I18n`, `src/db/migrations/` → `Core`).
# The class name is what `mikro_orm_migrations` stores, so it is the database's
# key for "what has run"; scoping it by module is what makes it unique across
# every module the platform can compose, including one that arrives from an
# installed package the generator never sees.
#
# `orderMigrations` enforces the same rule at runtime (`unscoped-name`), which
# is the only place a package's name can be checked. This is the build-time
# half, for the core tree.
# ──────────────────────────────────────────────────────────────────────────

# `orders` → `Orders`, `customer_accounts` → `CustomerAccounts`, `_i18n` → `I18n`.
# POSIX awk only — the CI image ships mawk, not gawk.
pascal_segment() {
  printf '%s\n' "${1#_}" | awk -F'_' '{
    out = ""
    for (i = 1; i <= NF; i++) {
      if (length($i) == 0) continue
      out = out toupper(substr($i, 1, 1)) substr($i, 2)
    }
    print out
  }'
}

class_files=()
for f in "${changed_files[@]}"; do
  if [[ "$f" == "$core_migrations_dir"/*.ts ]]; then
    class_files+=("$f")
    continue
  fi
  for dir in "${module_dirs[@]}"; do
    if [[ "$f" == "$dir"/*/migrations/*.ts ]] || [[ "$f" == "$dir"/migrations/*.ts ]]; then
      class_files+=("$f")
      break
    fi
  done
done
if [[ "$mode" == "full" ]]; then
  while IFS= read -r f; do class_files+=("$f"); done < <(
    { find "${module_dirs[@]}" -path '*/migrations/*.ts' 2>/dev/null
      find "$core_migrations_dir" -name '*.ts' 2>/dev/null; }
  )
fi
if [ "${#class_files[@]}" -gt 0 ]; then
  mapfile -t class_files < <(printf '%s\n' "${class_files[@]}" | sort -u)
fi

# A full-tree run that finds no migration at all has judged nothing, and would
# report the same green as a tree whose every class name is correct. In --diff
# mode an empty list is the ordinary "this MR touched no migration".
if [[ "$mode" == "full" ]] && [ "${#class_files[@]}" -eq 0 ]; then
  red "✗ check-naming found no migration file under backend/src — the migration"
  red "  class-scope rule would judge nothing. Refusing to report a vacuous pass."
  exit 2
fi

for f in "${class_files[@]}"; do
  [ -f "$f" ] || continue
  module_id="core"
  for dir in "${module_dirs[@]}"; do
    if [[ "$f" == "$dir"/* ]]; then
      module_id="$(basename "$dir")"
      break
    fi
  done
  prefix="$(pascal_segment "$module_id")"
  while IFS= read -r class_name; do
    [ -n "$class_name" ] || continue
    # 'Migration' (9) + '<YYYYMMDDTHHmmss>' (15) = 24 characters of preamble.
    class_tail="${class_name:24}"
    case "$class_tail" in
      "$prefix"*) ;;
      *)
        red "✗ Migration class $class_name in $f is not scoped by its module."
        red "  Module \"$module_id\" requires the name Migration<STAMP>${prefix}… —"
        red "  the class name is the database's key for what has run, and scoping it"
        red "  by module is what keeps it unique platform-wide."
        fail=1
        ;;
    esac
  done < <(
    grep -oE 'export class Migration[0-9]{8}T[0-9]{6}[A-Za-z0-9]*' "$f" 2>/dev/null |
      sed 's/^export class //' || true
  )
done

if [ "$fail" -eq 0 ]; then
  green "✓ Naming conventions OK ($mode mode)"
  exit 0
fi
exit 1
