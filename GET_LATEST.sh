#!/usr/bin/env bash
#
# Get the latest work onto the develop branch (Linux/Mac)
#
# develop is where every Claude Code session lands its work; main only moves on
# a release. Run this and you are on the newest develop -- no branch name to
# look up, ever.
set -euo pipefail

cd "$(dirname "$0")"

echo "Fetching from origin..."
git fetch origin --prune

# Refuse to touch a dirty working tree: switching branches would either drag
# uncommitted edits onto develop or fail halfway through.
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo
    echo "You have uncommitted changes. Commit or stash them first:"
    echo
    git --no-pager status --short
    echo
    echo "    git stash        # set them aside"
    echo "    git stash pop    # bring them back afterwards"
    exit 1
fi

if ! git rev-parse --verify --quiet refs/remotes/origin/develop >/dev/null; then
    echo
    echo "There is no develop branch on origin yet. Ask Claude to create it, or:"
    echo
    echo "    git checkout -b develop origin/main"
    echo "    git push -u origin develop"
    exit 1
fi

old=$(git rev-parse --verify --quiet refs/heads/develop || true)

if [ -z "$old" ]; then
    echo "Creating a local develop branch that follows origin/develop..."
    git checkout -b develop origin/develop
    echo
    echo "On develop, up to date."
else
    git checkout develop
    # Fast-forward only. If develop has diverged, that is worth looking at
    # rather than having a script invent a merge.
    if ! git merge --ff-only origin/develop; then
        echo
        echo "Your local develop has commits origin/develop does not, so it"
        echo "cannot fast-forward. Nothing has been changed. You have:"
        echo
        git --no-pager log --oneline origin/develop..develop
        exit 1
    fi

    count=$(git rev-list --count "$old"..HEAD)
    echo
    if [ "$count" = "0" ]; then
        echo "Already up to date -- nothing new on develop."
    else
        echo "$count new commit(s) on develop:"
        echo
        git --no-pager log --oneline "$old"..HEAD
        echo
        # Dependencies only need reinstalling when the lockfile actually moved.
        if git diff --name-only "$old"..HEAD | grep -qx 'package-lock.json'; then
            echo "package-lock.json changed -- running npm install..."
            npm install
        fi
    fi
fi

echo
echo "Ready. Start the editor with:  npm run dev"
