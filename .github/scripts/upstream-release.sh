#!/usr/bin/env bash
# Opens a PR that moves the upstream/ submodule to the newest upstream release when it is newer than the pinned tag.
# Releases only (not branch tips). Compares tag names, so the 300-file limit of the compare API does not apply.
# Env: GH_TOKEN (gh), DRY_RUN=true to print instead of pushing and opening the PR.
set -euo pipefail

REPO="guillaumemeyer/watermarks-remover"
DRY_RUN="${DRY_RUN:-false}"
summary() { echo "$1" | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"; }

# actions/checkout fetches the submodule at depth 1 without tags, so get them before looking the pinned tag up.
git -C upstream fetch --quiet --tags origin
current="$(git -C upstream describe --tags --exact-match HEAD)"
latest="$(gh api "repos/$REPO/releases/latest" --jq .tag_name)"
echo "pinned: $current, latest release: $latest"

if [ "$current" = "$latest" ] || [ "$(printf '%s\n%s\n' "$current" "$latest" | sort -V | tail -n1)" = "$current" ]; then
  summary "Upstream is up to date: pinned \`$current\`, latest release \`$latest\`."
  exit 0
fi

branch="chore/upstream-$latest"
if git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
  summary "Branch \`$branch\` already exists (open or closed PR); not opening another."
  exit 0
fi

git -C upstream checkout --quiet "$latest"
body="Moves \`upstream/\` from \`$current\` to \`$latest\`.

- Changes: https://github.com/$REPO/compare/$current...$latest
- Release notes: https://github.com/$REPO/releases/tag/$latest
- CI runs the patches check, the smoke test and the e2e test. There are no golden snapshots yet, so also look for quiet behaviour changes.
- Update the version row in THIRD_PARTY_NOTICES.md if it names the tag.

Opened by the upstream-release workflow."

if [ "$DRY_RUN" = "true" ]; then
  summary "Dry run: would open a PR from \`$branch\` ($current to $latest)."
  echo "$body"
  exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git switch -c "$branch"
git add upstream
git commit -m "chore: bump upstream to $latest"
git push origin "$branch"
gh pr create --base main --head "$branch" --title "chore: bump upstream to $latest" --body "$body"
# A PR opened with the default token does not start pull_request workflows, so start CI on the branch by hand.
gh workflow run ci.yml --ref "$branch"
summary "Opened a PR for \`$latest\` and started CI on \`$branch\`."
