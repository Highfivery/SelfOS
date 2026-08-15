/**
 * Compatibility barrel for the old `@selfos/core/books` entry point.
 *
 * The module is `books/` now (72 §5). This keeps the previous specifier working for one release so the
 * rename lands as a pure move rather than a move plus a hundred import edits in the same diff — and so a
 * branch written against the old path still builds while it rebases.
 *
 * Nothing new should import from here. Delete this file, and the `./story*` entries in `package.json`,
 * one release after the rename.
 */
export * from './books';
