import type { FileSystem } from '../host';
import type { PublishedManifest, ReaderChapter } from '../schemas';
import { getPublishedChapter, getPublishedManifest } from './storyService';

/**
 * Your Story export (64-your-story §3.9). Exports the PUBLISHED head — the self-contained snapshot readers see
 * (owner decision 2026-07-16: published version only), so a draft edit never leaks into an exported file and the
 * export always reflects what's actually been shared. Markdown v1 (a portable `.md`); PDF is a later slice. No AI.
 */

/** Render a published head as a single Markdown document (pure) — title, front matter, parts/chapters, back
 *  matter, and the "A Note on this book" honesty page. Chapters not present in the manifest's order are skipped. */
export function bookToMarkdown(manifest: PublishedManifest, chapters: ReaderChapter[]): string {
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const lines: string[] = [`# ${manifest.title}`, ''];
  if (manifest.matter?.epigraph) lines.push(`> ${manifest.matter.epigraph}`, '');
  if (manifest.matter?.dedication) lines.push(`*${manifest.matter.dedication}*`, '');
  for (const part of manifest.parts) {
    lines.push(`## ${part.title}`, '');
    for (const id of part.chapterIds) {
      const chapter = byId.get(id);
      if (!chapter) continue;
      lines.push(`### ${chapter.title}`, '', chapter.markdown.trim(), '');
    }
  }
  if (manifest.matter?.acknowledgments) {
    lines.push('## Acknowledgments', '', manifest.matter.acknowledgments.trim(), '');
  }
  if (manifest.noteOnBook) lines.push('---', '', `*${manifest.noteOnBook}*`, '');
  return `${lines.join('\n').trim()}\n`;
}

/** Build the published book's Markdown for export — the author's OWN published head. Null if the book has never
 *  been published (nothing to export yet). */
export async function buildPublishedMarkdown(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<{ title: string; markdown: string } | null> {
  const manifest = await getPublishedManifest(fs, key, personId, bookId);
  if (!manifest) return null;
  const chapters: ReaderChapter[] = [];
  for (const id of manifest.chapterOrder) {
    const chapter = await getPublishedChapter(fs, key, personId, bookId, id);
    if (chapter)
      chapters.push({ id: chapter.id, title: chapter.title, markdown: chapter.markdown });
  }
  return { title: manifest.title, markdown: bookToMarkdown(manifest, chapters) };
}

/** A safe filename stem from the book title (for the save dialog default). */
export function exportFileStem(title: string): string {
  const stem = title
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return stem.length > 0 ? stem : 'your-story';
}
