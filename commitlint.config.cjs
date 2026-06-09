/**
 * Conventional Commits enforcement (run by the commit-msg git hook).
 * Allowed types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
};
