#!/usr/bin/env bash
#
# Audit remote branches before making the repository public.
#
# The repository accumulated 400+ branches, most of them finished feature work.
# They are harmless but they are the first thing a visitor sees, and they
# clutter the branch picker every contributor uses.
#
# This script only ever PRINTS. It classifies each remote branch and writes the
# safe-to-delete list to a file for you to review before anything is removed.
#
# Three outcomes per branch:
#
#   merged     Its commits are ancestors of main. Ordinary merge.
#   squashed   Its commits are NOT in main, but the change it makes is. This is
#              what a squash merge leaves behind: GitHub replaces the branch's
#              commits with one new commit, so `git branch --merged` and
#              `merge-base --is-ancestor` both call the branch unmerged even
#              though every line of it shipped. Detected the way
#              git-delete-squashed does: synthesise the branch's whole diff as
#              one commit on top of the merge base, then ask `git cherry`
#              whether main already contains an equivalent patch.
#   orphaned   Shares NO history with main at all — not one common commit.
#              main was rewritten at some point and these branches are relics
#              of the lineage before it. `git diff main...branch` cannot even
#              run on them ("no merge base"), so they must be handled
#              separately rather than reported as ordinary unmerged work.
#   unmerged   Neither. Real work that exists only on this branch.
#
# Deleting a merged or squashed branch loses nothing. An orphaned branch is a
# judgement call: its work is real but belongs to a history main no longer
# shares. Read the list before deciding.
#
# Usage:
#   ./scripts/audit-branches.sh                 # report
#   ./scripts/audit-branches.sh --write-list    # also write the delete list
#
# To actually delete, after reading the list:
#   xargs -a /tmp/branches-to-delete.txt -n 50 git push origin --delete
#
set -euo pipefail

MAIN="${MAIN_BRANCH:-main}"
LIST="${LIST_FILE:-/tmp/branches-to-delete.txt}"
WRITE=0
[ "${1:-}" = "--write-list" ] && WRITE=1

echo "Fetching (this pulls every remote branch; it can take a minute)..."
git fetch origin --prune >/dev/null 2>&1

merged=(); squashed=(); unmerged=(); orphaned=(); protected=()

# Is the change this branch makes already in MAIN, even though its commits are
# not? Build a single commit containing the branch's tree, parented on the
# merge base, and let `git cherry` decide by patch-id.
already_applied() {
  local branch="$1" base tree synthetic
  base=$(git merge-base "origin/$MAIN" "origin/$branch" 2>/dev/null) || return 1
  tree=$(git rev-parse "origin/$branch^{tree}" 2>/dev/null) || return 1
  # An empty diff against the base means the branch changes nothing at all.
  if [ -z "$(git diff --name-only "$base" "origin/$branch" 2>/dev/null)" ]; then
    return 0
  fi
  synthetic=$(git commit-tree "$tree" -p "$base" -m _ 2>/dev/null) || return 1
  # `git cherry` prefixes a commit with "-" when an equivalent patch is
  # already upstream, and "+" when it is not.
  [ "$(git cherry "origin/$MAIN" "$synthetic" 2>/dev/null | cut -c1)" = "-" ]
}

total=0
while read -r ref; do
  b="${ref#refs/heads/}"
  total=$((total + 1))
  case "$b" in
    "$MAIN"|master|develop|gh-pages|release/*)
      protected+=("$b"); continue ;;
  esac
  if [ -z "$(git merge-base "origin/$MAIN" "origin/$b" 2>/dev/null)" ]; then
    # No common ancestor at all. Every commit-range operation against main is
    # undefined for this branch, so classify it here and do not measure it
    # against main below.
    orphaned+=("$b")
  elif git merge-base --is-ancestor "origin/$b" "origin/$MAIN" 2>/dev/null; then
    merged+=("$b")
  elif already_applied "$b"; then
    squashed+=("$b")
  else
    unmerged+=("$b")
  fi
  printf '\r  checked %d/%d' "$total" "$total" >&2
done < <(git ls-remote --heads origin | awk '{print $2}')
printf '\r%*s\r' 40 '' >&2

echo
echo "  Protected:                          ${#protected[@]}"
echo "  Merged into $MAIN:                  ${#merged[@]}"
echo "  Squash-merged (change is in $MAIN):  ${#squashed[@]}"
echo "  Orphaned (no shared history):       ${#orphaned[@]}"
echo "  Genuinely unmerged:                 ${#unmerged[@]}"
echo
echo "  Safe to delete now:  $(( ${#merged[@]} + ${#squashed[@]} ))"
echo "  Needs your decision: ${#orphaned[@]} orphaned + ${#unmerged[@]} unmerged"
echo

if [ "${#orphaned[@]}" -gt 0 ]; then
  echo "Orphaned branches — no commit in common with $MAIN. These predate a"
  echo "rewrite of $MAIN. Their contents are NOT reachable from $MAIN's history,"
  echo "which is also why anything committed on them (old .env files, keys from"
  echo "an earlier iteration) is invisible to a scan that only walks $MAIN."
  echo
  for b in "${orphaned[@]}"; do
    n=$(git rev-list --count "origin/$b" 2>/dev/null || echo '?')
    d=$(git log -1 --format=%as "origin/$b" 2>/dev/null || echo '?')
    printf '  %-58s %5s commits  last %s\n' "$b" "$n" "$d"
  done
  echo
fi

if [ "${#unmerged[@]}" -gt 0 ]; then
  echo "Branches sharing history with $MAIN but carrying work not in it:"
  for b in "${unmerged[@]}"; do
    n=$(git rev-list --count "origin/$MAIN..origin/$b" 2>/dev/null || echo '?')
    f=$(git diff --name-only "origin/$MAIN...origin/$b" 2>/dev/null | wc -l | tr -d ' ')
    d=$(git log -1 --format=%as "origin/$b" 2>/dev/null || echo '?')
    printf '  %-58s %5s commits  %4s files  last %s\n' "$b" "$n" "$f" "$d"
  done
  echo
fi

if [ "$WRITE" = 1 ]; then
  printf '%s\n' "${merged[@]}" "${squashed[@]}" | grep -v '^$' > "$LIST"
  if [ "${#orphaned[@]}" -gt 0 ]; then
    printf '%s\n' "${orphaned[@]}" > "${LIST%.txt}-orphaned.txt"
    echo "Wrote ${#orphaned[@]} ORPHANED branch names to ${LIST%.txt}-orphaned.txt"
    echo "  (kept in a separate file on purpose — read it before deleting)"
  fi
  echo "Wrote $(wc -l < "$LIST" | tr -d ' ') branch names to $LIST"
  echo "Review it, then:"
  echo "  xargs -a $LIST -n 50 git push origin --delete"
else
  echo "Re-run with --write-list to write the deletable branches to $LIST"
fi
