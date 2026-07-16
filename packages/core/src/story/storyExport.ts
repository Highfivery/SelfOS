import type { FileSystem } from '../host';
import { toBase64 } from '../encoding';
import type { PublishedManifest, ReaderChapter } from '../schemas';
import { getPublishedChapter, getPublishedImageBytes, getPublishedManifest } from './storyService';
import { chapterParagraphs } from './storyText';

/** A decrypted published image, base64-ready for an inline `data:` URI (self-contained export — no image folder). */
export type ExportImage = { mime: string; base64: string };
export type ExportImages = Record<string, ExportImage>;

function dataUri(img: ExportImage): string {
  return `data:${img.mime};base64,${img.base64}`;
}

/**
 * Your Story export (64-your-story §3.9). Exports the PUBLISHED head — the self-contained snapshot readers see
 * (owner decision 2026-07-16: published version only), so a draft edit never leaks into an exported file and the
 * export always reflects what's actually been shared. Markdown v1 (a portable `.md`); PDF is a later slice. No AI.
 */

/** Render a published head as a single Markdown document (pure) — title, front matter, parts/chapters, back
 *  matter, and the "A Note on this book" honesty page. Chapters not present in the manifest's order are skipped. */
export function bookToMarkdown(
  manifest: PublishedManifest,
  chapters: ReaderChapter[],
  images: ExportImages = {},
): string {
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const lines: string[] = [`# ${manifest.title}`, ''];
  // Cover (a self-contained inline data URI — no separate images/ folder).
  const cover = manifest.coverImageId ? images[manifest.coverImageId] : undefined;
  if (cover) lines.push(`![Cover](${dataUri(cover)})`, '');
  if (manifest.matter?.epigraph) lines.push(`> ${manifest.matter.epigraph}`, '');
  if (manifest.matter?.dedication) lines.push(`*${manifest.matter.dedication}*`, '');
  for (const part of manifest.parts) {
    lines.push(`## ${part.title}`, '');
    for (const id of part.chapterIds) {
      const chapter = byId.get(id);
      if (!chapter) continue;
      lines.push(`### ${chapter.title}`, '');
      // Interleave placed images after their anchor paragraph (§3.8).
      const paras = chapterParagraphs(chapter.markdown);
      paras.forEach((para, i) => {
        lines.push(para, '');
        for (const pl of chapter.imagePlacements.filter((p) => p.afterAnchor === `p${i}`)) {
          const img = images[pl.imageId];
          if (img) lines.push(`![${pl.caption || 'Image'}](${dataUri(img)})`, '');
        }
      });
    }
  }
  if (manifest.matter?.acknowledgments) {
    lines.push('## Acknowledgments', '', manifest.matter.acknowledgments.trim(), '');
  }
  if (manifest.noteOnBook) lines.push('---', '', `*${manifest.noteOnBook}*`, '');
  return `${lines.join('\n').trim()}\n`;
}

/** Read the author's OWN published head (manifest + chapters, in order). Null if never published. */
async function readPublishedHead(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<{
  manifest: PublishedManifest;
  chapters: ReaderChapter[];
  images: ExportImages;
} | null> {
  const manifest = await getPublishedManifest(fs, key, personId, bookId);
  if (!manifest) return null;
  const chapters: ReaderChapter[] = [];
  for (const id of manifest.chapterOrder) {
    const chapter = await getPublishedChapter(fs, key, personId, bookId, id);
    if (chapter)
      chapters.push({
        id: chapter.id,
        title: chapter.title,
        markdown: chapter.markdown,
        imagePlacements: chapter.imagePlacements,
      });
  }
  // Load the frozen bytes for every referenced image → an inline-data-URI map (self-contained export).
  const images: ExportImages = {};
  for (const entry of manifest.images) {
    const bytes = await getPublishedImageBytes(fs, key, personId, bookId, entry.id);
    if (bytes) images[entry.id] = { mime: entry.mime, base64: toBase64(bytes) };
  }
  return { manifest, chapters, images };
}

/** Build the published book's Markdown for export — null if the book has never been published. */
export async function buildPublishedMarkdown(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<{ title: string; markdown: string } | null> {
  const head = await readPublishedHead(fs, key, personId, bookId);
  return head
    ? {
        title: head.manifest.title,
        markdown: bookToMarkdown(head.manifest, head.chapters, head.images),
      }
    : null;
}

/** Build the published book's print HTML for export — null if the book has never been published. */
export async function buildPublishedHtml(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<{ title: string; html: string } | null> {
  const head = await readPublishedHead(fs, key, personId, bookId);
  return head
    ? { title: head.manifest.title, html: bookToHtml(head.manifest, head.chapters, head.images) }
    : null;
}

const PRINT_CSS = `
@page { margin: 1in; }
body { font-family: Georgia, 'Times New Roman', serif; font-size: 12pt; line-height: 1.6; color: #1a1a1a; }
.cover { text-align: center; margin: 2.5in 0; page-break-after: always; }
.cover h1 { font-size: 30pt; margin: 0; }
h2 { page-break-before: always; font-size: 20pt; }
h3 { font-size: 15pt; margin-top: 1.5em; }
p { margin: 0 0 0.8em; text-align: justify; }
.dedication { text-align: center; font-style: italic; margin: 1.5em 0; }
.epigraph { font-style: italic; border-left: 3px solid #ccc; padding-left: 1em; color: #555; }
hr { border: none; border-top: 1px solid #ccc; margin: 2em 0; }
.note { color: #555; font-size: 10pt; }
.coverImg { display: block; margin: 0 auto 1em; max-width: 4in; width: 100%; }
figure.placed { margin: 1.5em 0; text-align: center; page-break-inside: avoid; }
figure.placed img { max-width: 100%; }
figure.placed figcaption { font-style: italic; color: #555; font-size: 10pt; margin-top: 0.4em; }
`.trim();

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
/** Escape, then apply the ONLY inline markdown the biographer emits in prose (bold/italic — no headings/lists/
 *  tables per the generation prompt). Escaping FIRST makes this safe by construction: any `<`/`>` in the prose
 *  is neutralized before we add our own tags, so no raw HTML/script can survive (spec-34's no-raw-HTML rule). */
function inlineHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}
/** Render a chapter's prose to HTML, interleaving any placed images (data URIs) after their anchor paragraph. */
function chapterHtml(chapter: ReaderChapter, images: ExportImages): string {
  const paras = chapterParagraphs(chapter.markdown);
  const out: string[] = [];
  paras.forEach((para, i) => {
    out.push(`<p>${inlineHtml(para.replace(/\n/g, ' '))}</p>`);
    for (const pl of chapter.imagePlacements.filter((p) => p.afterAnchor === `p${i}`)) {
      const img = images[pl.imageId];
      if (!img) continue;
      out.push(
        `<figure class="placed"><img src="${dataUri(img)}" alt="${escapeHtml(pl.caption || 'Image')}"/>` +
          (pl.caption ? `<figcaption>${escapeHtml(pl.caption)}</figcaption>` : '') +
          '</figure>',
      );
    }
  });
  return out.join('\n');
}

function matterHtml(md: string): string {
  return md
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => `<p>${inlineHtml(p.replace(/\n/g, ' '))}</p>`)
    .join('\n');
}

/** Render a published head as a self-contained, print-styled HTML document for `printToPDF` (§3.9). Safe by
 *  construction — all text is HTML-escaped before the (bold/italic-only) inline formatting is applied. */
export function bookToHtml(
  manifest: PublishedManifest,
  chapters: ReaderChapter[],
  images: ExportImages = {},
): string {
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const cover = manifest.coverImageId ? images[manifest.coverImageId] : undefined;
  const body: string[] = [
    `<header class="cover">${
      cover ? `<img class="coverImg" src="${dataUri(cover)}" alt="Cover"/>` : ''
    }<h1>${escapeHtml(manifest.title)}</h1></header>`,
  ];
  if (manifest.matter?.dedication) {
    body.push(`<p class="dedication">${escapeHtml(manifest.matter.dedication)}</p>`);
  }
  if (manifest.matter?.epigraph) {
    body.push(`<blockquote class="epigraph">${escapeHtml(manifest.matter.epigraph)}</blockquote>`);
  }
  for (const part of manifest.parts) {
    body.push(`<h2>${escapeHtml(part.title)}</h2>`);
    for (const id of part.chapterIds) {
      const chapter = byId.get(id);
      if (!chapter) continue;
      body.push(
        `<section class="chapter"><h3>${escapeHtml(chapter.title)}</h3>${chapterHtml(chapter, images)}</section>`,
      );
    }
  }
  if (manifest.matter?.acknowledgments) {
    body.push(`<h2>Acknowledgments</h2>${matterHtml(manifest.matter.acknowledgments)}`);
  }
  if (manifest.noteOnBook) {
    body.push(`<hr/><p class="note"><em>${escapeHtml(manifest.noteOnBook)}</em></p>`);
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(
    manifest.title,
  )}</title><style>${PRINT_CSS}</style></head><body>${body.join('\n')}</body></html>`;
}

/** A safe filename stem from the book title (for the save dialog default). */
export function exportFileStem(title: string): string {
  const stem = title
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return stem.length > 0 ? stem : 'your-story';
}
