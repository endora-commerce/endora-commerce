#!/usr/bin/env bash
# Which kind of scheduled run this is — asked once, answered in one place.
#
# **Sourced, never executed.** Two scheduled jobs branch on `CI_SCHEDULE_KIND`:
# `perf:backend` picks the tier of benchmarks to run, `perf:storefront` picks
# the Lighthouse sample count. Both used to read the variable inline in
# `.gitlab-ci.yml`, and both read it the same wrong way:
#
#     if [ "$CI_SCHEDULE_KIND" = "weekly-heavy" ]; then …; fi
#
# ## What that spelling cannot say
#
# It has one branch and three inputs. `weekly-heavy` takes the branch; **unset**
# and **`weekly-heavvy`** both fall through to the same silent else, and the
# nightly then runs by accident of the default rather than by decision. On the
# schedule that produced pipeline 13444 the variable was not set at all — the
# schedule carries no variables — so the `weekly-heavy` branch had never been
# reachable in either job, and nothing anywhere said so.
#
# So the three states are separated, and two of them are loud:
#
#   * a **recognised** kind — printed on stdout, nothing said;
#   * **unset on a scheduled pipeline** — exit 2. The schedule has not declared
#     what it is, and taking the cheaper branch is not a decision anybody took;
#   * **unset off a scheduled pipeline** — `nightly`, *stated on stderr*. A
#     developer running this by hand, or the manual merge-request run, has no
#     schedule to declare anything; the default is real and it says so;
#   * **an unrecognised value** — exit 2, whatever the pipeline source, naming
#     the value and the kinds that exist. A typo in a GitLab settings field is
#     invisible from the repository, and this is the only place it can surface.
#
# Exit 2 is this estate's "the input could not be read" code, and that is what
# an undeclared schedule is: not a finding about the tree, a run that does not
# know what it was asked to do.

# The kinds, in the order a message lists them. Adding one is a change here and
# a rule in `.gitlab-ci.yml`; there is no third place.
SCHEDULE_KINDS='nightly weekly-heavy'

# resolve_schedule_kind [prefix]
#   stdout : the resolved kind, with no trailing newline
#   stderr : why, when the answer was not simply read off the variable
#   status : 0 resolved, 2 undeclared or unrecognised
resolve_schedule_kind() {
  local prefix="${1:-[schedule]}"
  local kind="${CI_SCHEDULE_KIND:-}"
  local source="${CI_PIPELINE_SOURCE:-}"

  if [ -z "$kind" ]; then
    if [ "$source" = 'schedule' ]; then
      echo "$prefix this is a scheduled pipeline (CI_PIPELINE_SOURCE=schedule) and CI_SCHEDULE_KIND is unset." >&2
      echo "$prefix A schedule declares which kind of run it is; nothing in this repository can declare it for one." >&2
      echo "$prefix Set CI_SCHEDULE_KIND on the schedule itself (CI/CD > Schedules > Edit > Variables) to one of: $SCHEDULE_KINDS." >&2
      echo "$prefix Refusing rather than assuming: taking the cheaper of the two branches here is a decision nobody took, and it would read as a pass." >&2
      return 2
    fi
    echo "$prefix CI_SCHEDULE_KIND is unset and CI_PIPELINE_SOURCE=\"${source:-<unset>}\" is not a schedule; running as \`nightly\`." >&2
    printf 'nightly'
    return 0
  fi

  local known
  for known in $SCHEDULE_KINDS; do
    if [ "$kind" = "$known" ]; then
      printf '%s' "$kind"
      return 0
    fi
  done

  echo "$prefix CI_SCHEDULE_KIND=\"$kind\" is not a kind this repository recognises." >&2
  echo "$prefix Recognised kinds: $SCHEDULE_KINDS." >&2
  echo "$prefix This is what a typo in a GitLab schedule variable looks like from here, and it is the only place it can be seen." >&2
  return 2
}
