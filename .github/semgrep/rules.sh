#!/bin/sh
# Puts the pinned Semgrep rules (rules.txt: a semgrep-rules commit, its rule count and the rule
# files of the packs the sast jobs use) in <dir>, for `semgrep scan --config <dir>`. Git checks
# every file against the commit, and nothing asks semgrep.dev. Runs in the semgrep/semgrep container.
# Usage: sh rules.sh <rules.txt> <dir>
set -eu
list=$1
dir=$2
commit=$(sed -n 's/^commit //p' "$list")
rules=$(sed -n 's/^rules //p' "$list")
echo "$commit" | grep -Eqx '[0-9a-f]{40}' || { echo "rules.txt: no 40-character commit line" >&2; exit 1; }
grep -v -e '^#' -e '^commit ' -e '^rules ' "$list" > "$dir.paths"
git init -q "$dir"
git -C "$dir" fetch -q --depth 1 https://github.com/semgrep/semgrep-rules "$commit"
[ "$(git -C "$dir" rev-parse FETCH_HEAD)" = "$commit" ]
git -C "$dir" -c gc.auto=0 checkout -q FETCH_HEAD --pathspec-from-file="$dir.paths"
# Registry ids (javascript.jose.security.jwt-hardcode.<id>), so `nosemgrep: <rule-id>` lines keep
# working; the scan passes --no-rewrite-rule-ids so Semgrep adds no path of its own.
while read -r path; do
  prefix=$(echo "${path%.*}" | tr / .)
  sed -i "s/^\( *- id: \)/\1$prefix./" "$dir/$path"
  grep -q "^ *- id: $prefix\." "$dir/$path" || { echo "$path: no rule id rewritten" >&2; exit 1; }
done < "$dir.paths"
rm -rf "$dir/.git" "$dir.paths"
found=$(grep -rh -- '^ *- id: ' "$dir" | wc -l | tr -d ' ')
[ "$found" = "$rules" ] || { echo "found $found rules, rules.txt pins $rules" >&2; exit 1; }
echo "Semgrep rules: $found rules from semgrep/semgrep-rules@$commit"
