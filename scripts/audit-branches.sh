#!/usr/bin/env bash
#
# Audit remote branches before making the repository public.
#
# The repository accumulated 400+ branches, most of them merged feature work.
# They are harmless but they are the first thing a visitor sees, and they
# clutter the branch picker every contributor uses.
#
# This script only ever PRINTS. It classifies each remote branch as safe to
# delete (fully merged into main) or keep (carries unmerged commits), and
# writes the delete list to a file for you to review.
#
# Deleting a merged branch loses nothing: its commits are in main's history.
#
# Usage:
#   ./scripts/audit-branches.sh                 # report
#   ./scripts/audit-branches.sh --write-list    # also write /tmp/branches-to-delete.txt
#
# To actually delete, after reading the list:
#   xargs -a /tmp/branches-to-delete.txt -n 50 git push origin --delete
#
set -euo pipefail

MAIN="${MAIN_BRANCH:-main}"
LIST="${LIST_FILE:-/tmp/branches-to-delete.txt}"
WRITE=0
[ "${1:-}" = "--write-list" ] && WRITE=1

echo "Fetching..."
git fetch origin --prune >/dev/null 2>&1

merged=()
unmerged=()
protected=()

while read -r ref; do
  b="${ref#refs/heads/}"
  case "$b" in
    "$MAIN"|master|develop|gh-pages|release/*)
      protected+=("$b"); continue ;;
  esac
  if git merge-base --is-ancestor "origin/$b" "origin/$MAIN" 2>/dev/null; then
    merged+=("$b")
  else
    unmerged+=("$b")
  fi
done < <(git ls-remote --heads origin | awk '{print $2}')

echo
echo "Protected:            ${#protected[@]}"
echo "Merged into $MAIN:    ${#merged[@]}   <- safe to delete"
echo "Carrying unmerged:    ${#unmerged[@]}   <- review each"
echo

if [ "${#unmerged[@]}" -gt 0 ]; then
  echo "Branches with commits not in $MAIN — check before deleting any of these:"
  for b in "${unmerged[@]}"; do
    n=$(git rev-list --count "origin/$MAIN..origin/$b" 2>/dev/null || echo '?')
    d=$(git log -1 --format=%as "origin/$b" 2>/dev/null || echo '?')
    printf '  %-60s %4s commits  last %s\n' "$b" "$n" "$d"
  done
  echo
fi

if [ "$WRITE" = 1 ]; then
  printf '%s\n' "${merged[@]}" > "$LIST"
  echo "Wrote ${#merged[@]} merged branch names to $LIST"
  echo "Review it, then:"
  echo "  xargs -a $LIST -n 50 git push origin --delete"
else
  echo "Re-run with --write-list to write the deletable branches to $LIST"
fi
