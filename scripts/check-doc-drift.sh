#!/usr/bin/env sh
# Doc-drift warning (non-blocking).
#
# Heuristic: if any staged file lives under a feature module
# (apps/desktop/src/features/<name>/...) but nothing under docs/specs/ is staged,
# warn that the feature's spec may be out of date. SelfOS keeps specs in lockstep
# with code (see CLAUDE.md → Living docs), so drift should be visible at commit time.
#
# v1 has no feature modules yet, so this is effectively a no-op until features land.

staged=$(git diff --cached --name-only --diff-filter=ACMR)

feature_changes=$(printf '%s\n' "$staged" | grep -E '^apps/desktop/src/features/[^/]+/' || true)
spec_changes=$(printf '%s\n' "$staged" | grep -E '^docs/specs/' || true)

if [ -n "$feature_changes" ] && [ -z "$spec_changes" ]; then
  modules=$(printf '%s\n' "$feature_changes" | sed -E 's#^apps/desktop/src/features/([^/]+)/.*#\1#' | sort -u)
  printf '\n⚠️  Doc-drift check: feature code changed but no docs/specs/ file is staged.\n'
  printf '   Affected module(s):\n'
  printf '%s\n' "$modules" | sed 's/^/     - /'
  printf '   Consider running the sync-docs skill to update the spec.\n\n'
fi

exit 0
