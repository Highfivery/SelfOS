import { colophonLines, mdSafeMatter } from './storyMatter';
import type { FileSystem } from '../host';
import { fromBase64, toBase64 } from '../encoding';
import type { PublishedManifest, ReaderChapter } from '../schemas';
import {
  getPublishedChapter,
  getPublishedImageBytes,
  getPublishedManifest,
  getStoryImageBytes,
} from './storyService';
import { getPerson } from '../people';
import { readOwnBook, SOURCE_KIND_NOUN } from './storyPublish';
import { chapterParagraphs } from './storyText';
import { makeZip, type ZipEntry } from '../zip';
import type { ChapterSourceSummary } from '../schemas';

/** A decrypted published image, base64-ready for an inline `data:` URI (self-contained export — no image folder). */
export type ExportImage = { mime: string; base64: string };
export type ExportImages = Record<string, ExportImage>;

function dataUri(img: ExportImage): string {
  return `data:${img.mime};base64,${img.base64}`;
}

/** One chapter's generic source line, e.g. "3 coaching insights, 2 memories you shared". Never any id/content. */
function sourceLine(counts: ChapterSourceSummary['counts']): string {
  return counts.map(({ kind, count }) => `${count} ${SOURCE_KIND_NOUN[kind] ?? kind}`).join(', ');
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
  // Dramatis personae (§17.2) — the opt-in cast list, frozen at publish.
  if (manifest.cast && manifest.cast.length > 0) {
    lines.push('## The people in this book', '');
    for (const member of manifest.cast) {
      lines.push(
        member.relationship
          ? `- **${mdSafeMatter(member.name)}** — ${mdSafeMatter(member.relationship)}`
          : `- **${mdSafeMatter(member.name)}**`,
      );
    }
    lines.push('');
  }
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
    lines.push('## Acknowledgments', '', mdSafeMatter(manifest.matter.acknowledgments.trim()), '');
  }
  if (manifest.matter?.aboutAuthor) {
    lines.push('## About the author', '', mdSafeMatter(manifest.matter.aboutAuthor.trim()), '');
  }
  // Sources appendix (§18.3) — a GENERIC per-chapter breakdown of what the book drew on (kind counts only, no
  // ids/content/dates), so an exported copy leaks nothing about the private records behind it.
  if (manifest.chapterSources && manifest.chapterSources.length > 0) {
    lines.push('## Sources', '');
    for (const cs of manifest.chapterSources) {
      const line = sourceLine(cs.counts);
      if (line) lines.push(`- **${mdSafeMatter(cs.title)}** — drawn from ${line}`);
    }
    lines.push('');
  }
  if (manifest.noteOnBook) lines.push('---', '', `*${manifest.noteOnBook}*`, '');
  // The colophon closes the book — the person's own line (if any) plus the standing boundary, which is
  // never theirs to remove (§8.2). An exported copy can leave the vault, so it must carry it.
  lines.push(
    '---',
    '',
    ...colophonLines(manifest.matter).map((line) => `*${mdSafeMatter(line)}*`),
    '',
  );
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

/**
 * Read the DRAFT head for export (§13.6.1) — the owner's own live book (every written chapter in order + a live
 * honesty note + cover + placements), so a never-published book can still be exported. Reuses `readOwnBook`'s
 * draft manifest/chapters + resolves the draft image bytes. Null before the book/outline exists.
 */
async function readDraftHead(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<{
  manifest: PublishedManifest;
  chapters: ReaderChapter[];
  images: ExportImages;
} | null> {
  const view = await readOwnBook(fs, key, personId, bookId);
  if (!view) return null;
  const images: ExportImages = {};
  for (const entry of view.manifest.images) {
    const bytes = await getStoryImageBytes(fs, key, personId, bookId, entry.id);
    if (bytes) images[entry.id] = { mime: entry.mime, base64: toBase64(bytes) };
  }
  return { manifest: view.manifest, chapters: view.chapters, images };
}

/** Build the DRAFT head's Markdown for export (§13.6.1) — null before the book has an outline. */
export async function buildDraftMarkdown(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<{ title: string; markdown: string } | null> {
  const head = await readDraftHead(fs, key, personId, bookId);
  return head
    ? {
        title: head.manifest.title,
        markdown: bookToMarkdown(head.manifest, head.chapters, head.images),
      }
    : null;
}

/** Build the DRAFT head's print HTML for export (§13.6.1) — null before the book has an outline. */
export async function buildDraftHtml(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<{ title: string; html: string } | null> {
  const head = await readDraftHead(fs, key, personId, bookId);
  return head
    ? { title: head.manifest.title, html: bookToHtml(head.manifest, head.chapters, head.images) }
    : null;
}

const PRINT_CSS = `
/* Page geometry (trim size + margins + footer page numbers) is set by the host's printToPDF options (§18.3),
   so the CSS owns only typography — no @page margin here, or it would double the printed margins. */
body { font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.55; color: #1a1a1a; }
.cover { text-align: center; margin: 2in 0; page-break-after: always; }
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
  // Escapes quotes too, so the same helper is safe in ATTRIBUTE values (e.g. `alt="…"`) — required for the
  // strict XHTML in an EPUB (an unescaped `"` in an attribute is a hard XML parse error), harmless in text.
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  // Dramatis personae (§17.2) — the opt-in cast list, frozen at publish.
  if (manifest.cast && manifest.cast.length > 0) {
    const rows = manifest.cast
      .map((m) =>
        m.relationship
          ? `<li><strong>${escapeHtml(m.name)}</strong> — ${escapeHtml(m.relationship)}</li>`
          : `<li><strong>${escapeHtml(m.name)}</strong></li>`,
      )
      .join('');
    body.push(`<section class="cast"><h2>The people in this book</h2><ul>${rows}</ul></section>`);
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
  if (manifest.matter?.aboutAuthor) {
    body.push(`<h2>About the author</h2>${matterHtml(manifest.matter.aboutAuthor)}`);
  }
  // Sources appendix (§18.3) — generic per-chapter kind counts only (no ids/content), safe in an exported book.
  if (manifest.chapterSources && manifest.chapterSources.length > 0) {
    const rows = manifest.chapterSources
      .map((cs) => {
        const line = sourceLine(cs.counts);
        return line
          ? `<li><strong>${escapeHtml(cs.title)}</strong> — drawn from ${escapeHtml(line)}</li>`
          : '';
      })
      .join('');
    if (rows) body.push(`<section class="sources"><h2>Sources</h2><ul>${rows}</ul></section>`);
  }
  if (manifest.noteOnBook) {
    body.push(`<hr/><p class="note"><em>${escapeHtml(manifest.noteOnBook)}</em></p>`);
  }
  // The colophon closes the book (§8.2) — their line, then the boundary that always renders.
  body.push(
    `<hr/><p class="note">${colophonLines(manifest.matter)
      .map((line) => `<em>${escapeHtml(line)}</em>`)
      .join('<br/>')}</p>`,
  );
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

// --- EPUB (§18.3, #293) --------------------------------------------------------------------------------------
// A minimal, valid EPUB3: a store-only ZIP of an OCF container (mimetype first + uncompressed), an OPF package,
// an EPUB nav, per-chapter XHTML, and image files. Reuses the safe text helpers (escape-first, bold/italic only)
// and stores images as files (never data URIs — the EPUB-correct way). Pure.

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

const EPUB_CSS = `
body { font-family: Georgia, 'Times New Roman', serif; line-height: 1.55; margin: 1em; color: #1a1a1a; }
h1 { font-size: 1.7em; margin: 0 0 0.6em; } h2 { font-size: 1.35em; } h3 { font-size: 1.15em; }
p { margin: 0 0 0.8em; text-align: justify; }
.dedication { text-align: center; font-style: italic; margin: 1.5em 0; }
.epigraph { font-style: italic; border-left: 3px solid #ccc; padding-left: 1em; color: #555; }
.note { color: #555; font-size: 0.9em; } .cover { text-align: center; }
.cover img, figure img { max-width: 100%; } figure { margin: 1.5em 0; text-align: center; }
figcaption { font-style: italic; color: #555; font-size: 0.9em; }
`.trim();

/** File extension for an image mime (defaults to `.img` for an unknown type — the OPF still declares the mime). */
function imageExt(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'img';
}

/** Wrap body markup as a well-formed XHTML document (EPUB requires valid XML, not loose HTML). */
function xhtmlDoc(title: string, bodyInner: string): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<!DOCTYPE html>\n` +
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">` +
    `<head><meta charset="utf-8"/><title>${escapeHtml(title)}</title>` +
    `<link rel="stylesheet" type="text/css" href="style.css"/></head>` +
    `<body>${bodyInner}</body></html>`
  );
}

/** A chapter's XHTML body — prose + placed images resolved to FILE paths (`images/<id>.<ext>`), not data URIs. */
function chapterXhtmlBody(
  chapter: ReaderChapter,
  imageFile: (id: string) => string | undefined,
): string {
  const paras = chapterParagraphs(chapter.markdown);
  const out: string[] = [`<h1>${escapeHtml(chapter.title)}</h1>`];
  paras.forEach((para, i) => {
    out.push(`<p>${inlineHtml(para.replace(/\n/g, ' '))}</p>`);
    for (const pl of chapter.imagePlacements.filter((p) => p.afterAnchor === `p${i}`)) {
      const src = imageFile(pl.imageId);
      if (!src) continue;
      out.push(
        `<figure><img src="${src}" alt="${escapeHtml(pl.caption || 'Image')}"/>` +
          (pl.caption ? `<figcaption>${escapeHtml(pl.caption)}</figcaption>` : '') +
          '</figure>',
      );
    }
  });
  return out.join('\n');
}

/**
 * Build a valid EPUB3 for a published/reader head (§18.3). `authorName` → dc:creator; `uid` → a stable
 * dc:identifier; `modified` (a UTC ISO instant, from the manifest's publishedAt) → the required dcterms:modified.
 * Images are stored as files; every page reuses the escape-first (bold/italic-only) text helpers.
 */
export function bookToEpub(
  manifest: PublishedManifest,
  chapters: ReaderChapter[],
  images: ExportImages,
  opts: { authorName: string; uid: string; modified: string },
): Uint8Array {
  const byId = new Map(chapters.map((c) => [c.id, c]));

  // Referenced images → file entries. `imageFile(id)` gives the OPF-relative path, or undefined if absent.
  const imageEntries: { id: string; path: string; mime: string; bytes: Uint8Array }[] = [];
  for (const meta of manifest.images) {
    const img = images[meta.id];
    if (!img) continue;
    const path = `images/${meta.id}.${imageExt(meta.mime)}`;
    imageEntries.push({ id: meta.id, path, mime: meta.mime, bytes: fromBase64(img.base64) });
  }
  const imageFile = (id: string): string | undefined => imageEntries.find((e) => e.id === id)?.path;
  const coverEntry = manifest.coverImageId ? imageFile(manifest.coverImageId) : undefined;

  // --- Pages (spine order) ---
  type Page = { id: string; file: string; navTitle: string; xhtml: string };
  const pages: Page[] = [];

  // Title page: cover + title + dedication + epigraph.
  const titleBody: string[] = ['<section class="cover">'];
  if (coverEntry) titleBody.push(`<img src="${coverEntry}" alt="Cover"/>`);
  titleBody.push(`<h1>${escapeHtml(manifest.title)}</h1>`);
  if (opts.authorName) titleBody.push(`<p class="note">${escapeHtml(opts.authorName)}</p>`);
  titleBody.push('</section>');
  if (manifest.matter?.dedication)
    titleBody.push(`<p class="dedication">${escapeHtml(manifest.matter.dedication)}</p>`);
  if (manifest.matter?.epigraph)
    titleBody.push(
      `<blockquote class="epigraph">${escapeHtml(manifest.matter.epigraph)}</blockquote>`,
    );
  pages.push({
    id: 'titlepage',
    file: 'titlepage.xhtml',
    navTitle: manifest.title,
    xhtml: xhtmlDoc(manifest.title, titleBody.join('\n')),
  });

  // Optional dramatis personae page (§17.2).
  if (manifest.cast && manifest.cast.length > 0) {
    const rows = manifest.cast
      .map((m) =>
        m.relationship
          ? `<li><strong>${escapeHtml(m.name)}</strong> — ${escapeHtml(m.relationship)}</li>`
          : `<li><strong>${escapeHtml(m.name)}</strong></li>`,
      )
      .join('');
    pages.push({
      id: 'cast',
      file: 'cast.xhtml',
      navTitle: 'The people in this book',
      xhtml: xhtmlDoc(
        'The people in this book',
        `<h1>The people in this book</h1><ul>${rows}</ul>`,
      ),
    });
  }

  // One page per chapter, in part/order; the first chapter of a part carries the part title.
  let chapterIndex = 0;
  for (const part of manifest.parts) {
    let first = true;
    for (const id of part.chapterIds) {
      const chapter = byId.get(id);
      if (!chapter) continue;
      chapterIndex += 1;
      const partHeader = first ? `<h2>${escapeHtml(part.title)}</h2>` : '';
      pages.push({
        id: `chap${chapterIndex}`,
        file: `chap${chapterIndex}.xhtml`,
        navTitle: chapter.title,
        xhtml: xhtmlDoc(chapter.title, partHeader + chapterXhtmlBody(chapter, imageFile)),
      });
      first = false;
    }
  }

  // Back matter: acknowledgments, about the author, Sources, note, colophon (the boundary always renders).
  const back: string[] = [];
  if (manifest.matter?.acknowledgments)
    back.push(`<h2>Acknowledgments</h2>${matterHtml(manifest.matter.acknowledgments)}`);
  if (manifest.matter?.aboutAuthor)
    back.push(`<h2>About the author</h2>${matterHtml(manifest.matter.aboutAuthor)}`);
  if (manifest.chapterSources && manifest.chapterSources.length > 0) {
    const rows = manifest.chapterSources
      .map((cs) => {
        const line = sourceLine(cs.counts);
        return line
          ? `<li><strong>${escapeHtml(cs.title)}</strong> — drawn from ${escapeHtml(line)}</li>`
          : '';
      })
      .join('');
    if (rows) back.push(`<h2>Sources</h2><ul>${rows}</ul>`);
  }
  if (manifest.noteOnBook)
    back.push(`<p class="note"><em>${escapeHtml(manifest.noteOnBook)}</em></p>`);
  back.push(
    `<p class="note">${colophonLines(manifest.matter)
      .map((line) => `<em>${escapeHtml(line)}</em>`)
      .join('<br/>')}</p>`,
  );
  pages.push({
    id: 'backmatter',
    file: 'backmatter.xhtml',
    navTitle: 'Colophon',
    xhtml: xhtmlDoc('Colophon', back.join('\n')),
  });

  // --- Nav ---
  const navList = pages
    .map((p) => `<li><a href="${p.file}">${escapeHtml(p.navTitle)}</a></li>`)
    .join('');
  const navXhtml = xhtmlDoc(
    'Contents',
    `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${navList}</ol></nav>`,
  );

  // --- OPF ---
  const manifestItems = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="css" href="style.css" media-type="text/css"/>`,
    ...pages.map((p) => `<item id="${p.id}" href="${p.file}" media-type="application/xhtml+xml"/>`),
    ...imageEntries.map((e) => {
      const isCover = e.id === manifest.coverImageId;
      return `<item id="img-${e.id}" href="${e.path}" media-type="${e.mime}"${
        isCover ? ' properties="cover-image"' : ''
      }/>`;
    }),
  ].join('');
  const spine = pages.map((p) => `<itemref idref="${p.id}"/>`).join('');
  const opf =
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">` +
    `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">` +
    `<dc:identifier id="bookid">${escapeHtml(opts.uid)}</dc:identifier>` +
    `<dc:title>${escapeHtml(manifest.title)}</dc:title>` +
    `<dc:language>en</dc:language>` +
    (opts.authorName ? `<dc:creator>${escapeHtml(opts.authorName)}</dc:creator>` : '') +
    `<meta property="dcterms:modified">${escapeHtml(opts.modified)}</meta>` +
    `</metadata>` +
    `<manifest>${manifestItems}</manifest>` +
    `<spine>${spine}</spine>` +
    `</package>`;

  const container =
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">` +
    `<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>` +
    `</container>`;

  // --- Assemble the ZIP (mimetype FIRST + stored) ---
  const entries: ZipEntry[] = [
    { name: 'mimetype', data: utf8('application/epub+zip') },
    { name: 'META-INF/container.xml', data: utf8(container) },
    { name: 'OEBPS/content.opf', data: utf8(opf) },
    { name: 'OEBPS/nav.xhtml', data: utf8(navXhtml) },
    { name: 'OEBPS/style.css', data: utf8(EPUB_CSS) },
    ...pages.map((p) => ({ name: `OEBPS/${p.file}`, data: utf8(p.xhtml) })),
    ...imageEntries.map((e) => ({ name: `OEBPS/${e.path}`, data: e.bytes })),
  ];
  return makeZip(entries);
}

/** A UTC `dcterms:modified` instant (seconds precision) from an ISO timestamp, defaulting deterministically. */
function epubModified(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/.exec(iso);
  return `${m ? m[1] : '1970-01-01T00:00:00'}Z`;
}

/** Build the PUBLISHED head as an EPUB — null if the book has never been published. */
export async function buildPublishedEpub(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<{ title: string; bytes: Uint8Array } | null> {
  const head = await readPublishedHead(fs, key, personId, bookId);
  if (!head) return null;
  const author = await getPerson(fs, key, personId);
  return {
    title: head.manifest.title,
    bytes: bookToEpub(head.manifest, head.chapters, head.images, {
      authorName: author?.displayName ?? '',
      uid: `urn:selfos:${bookId}`,
      modified: epubModified(head.manifest.publishedAt),
    }),
  };
}

/** Build the DRAFT head as an EPUB (§13.6.1) — null before the book has an outline. */
export async function buildDraftEpub(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<{ title: string; bytes: Uint8Array } | null> {
  const head = await readDraftHead(fs, key, personId, bookId);
  if (!head) return null;
  const author = await getPerson(fs, key, personId);
  return {
    title: head.manifest.title,
    bytes: bookToEpub(head.manifest, head.chapters, head.images, {
      authorName: author?.displayName ?? '',
      uid: `urn:selfos:${bookId}`,
      modified: epubModified(head.manifest.publishedAt),
    }),
  };
}

// --- DOCX (§18.3, #293) --------------------------------------------------------------------------------------
// A minimal, valid Office Open XML (.docx) — a ZIP of the OOXML parts (Content_Types, package rels, the
// WordprocessingML `document.xml`, `styles.xml`, image parts + their relationships). An editable manuscript that
// mirrors the reader's matter + the generic Sources appendix. Pure; reuses the ZIP writer + escape-first helpers.

const EMU_PER_PX = 9525; // 96 dpi
const MAX_IMG_WIDTH_EMU = 5029200; // 5.5in — fits a book page with margins

/** Image pixel dimensions from the file header (PNG IHDR / JPEG SOF); a safe fallback otherwise. */
function imageDimensions(bytes: Uint8Array, mime: string): { w: number; h: number } {
  if (mime === 'image/png' && bytes.length >= 24) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  if (mime === 'image/jpeg') {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = bytes[i + 1]!;
      // SOF0..SOF15 carry the frame size, except the non-SOF markers C4 (DHT), C8 (JPG), CC (DAC).
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return {
          h: (bytes[i + 5]! << 8) | bytes[i + 6]!,
          w: (bytes[i + 7]! << 8) | bytes[i + 8]!,
        };
      }
      i += 2 + ((bytes[i + 2]! << 8) | bytes[i + 3]!);
    }
  }
  return { w: 800, h: 600 };
}

/** Display EMU for an image, scaled to fit `MAX_IMG_WIDTH_EMU` while preserving aspect. */
function displayEmu(bytes: Uint8Array, mime: string): { cx: number; cy: number } {
  const { w, h } = imageDimensions(bytes, mime);
  let cx = Math.max(1, w) * EMU_PER_PX;
  let cy = Math.max(1, h) * EMU_PER_PX;
  if (cx > MAX_IMG_WIDTH_EMU) {
    cy = Math.round((cy * MAX_IMG_WIDTH_EMU) / cx);
    cx = MAX_IMG_WIDTH_EMU;
  }
  return { cx, cy };
}

/** Inline runs from prose: `**bold**` / `*italic*` (the only inline markup the biographer emits). Escape-safe. */
function inlineRuns(text: string): string {
  // Tokenize on ** and * (bold wins). Emits `<w:r>` runs with the right `<w:rPr>`.
  const runs: string[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (s: string, bold: boolean, italic: boolean): void => {
    if (!s) return;
    const rpr =
      bold || italic ? `<w:rPr>${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}</w:rPr>` : '';
    runs.push(`<w:r>${rpr}<w:t xml:space="preserve">${escapeHtml(s)}</w:t></w:r>`);
  };
  while ((m = re.exec(text)) !== null) {
    push(text.slice(last, m.index), false, false);
    if (m[1] !== undefined) push(m[1], true, false);
    else push(m[2]!, false, true);
    last = m.index + m[0].length;
  }
  push(text.slice(last), false, false);
  return runs.join('');
}

/** A WordprocessingML paragraph with an optional named style + inline runs. */
function docxPara(text: string, style?: string): string {
  const ppr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  return `<w:p>${ppr}${inlineRuns(text)}</w:p>`;
}

const DOCX_STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>` +
  `<w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="22"/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="240"/></w:pPr>` +
  `<w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="56"/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:spacing w:before="360" w:after="120"/></w:pPr>` +
  `<w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:b/><w:sz w:val="36"/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>` +
  `<w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:b/><w:sz w:val="28"/></w:rPr></w:style>` +
  `</w:styles>`;

/**
 * Build a valid .docx for a published/reader head (§18.3) — an editable manuscript mirroring the reader's matter
 * + the generic Sources appendix. Images are embedded as parts with DrawingML inline references; text reuses the
 * escape-first (bold/italic-only) helpers over the pseudonymized manifest/chapters.
 */
export function bookToDocx(
  manifest: PublishedManifest,
  chapters: ReaderChapter[],
  images: ExportImages,
  opts: { authorName: string },
): Uint8Array {
  const byId = new Map(chapters.map((c) => [c.id, c]));

  // Referenced images → parts + relationship ids. `imgXml(id)` yields the inline-drawing paragraph, or ''.
  type Img = {
    id: string;
    rid: string;
    path: string;
    mime: string;
    bytes: Uint8Array;
    cx: number;
    cy: number;
  };
  const imgs: Img[] = [];
  let ridN = 1;
  let docPrN = 1;
  for (const meta of manifest.images) {
    const img = images[meta.id];
    if (!img) continue;
    const bytes = fromBase64(img.base64);
    const { cx, cy } = displayEmu(bytes, meta.mime);
    imgs.push({
      id: meta.id,
      rid: `rId${100 + ridN++}`,
      path: `media/${meta.id}.${imageExt(meta.mime)}`,
      mime: meta.mime,
      bytes,
      cx,
      cy,
    });
  }
  const imgXml = (id: string): string => {
    const img = imgs.find((e) => e.id === id);
    if (!img) return '';
    const n = docPrN++;
    return (
      `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
      `<wp:extent cx="${img.cx}" cy="${img.cy}"/><wp:docPr id="${n}" name="Image ${n}"/>` +
      `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
      `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<pic:nvPicPr><pic:cNvPr id="${n}" name="Image ${n}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${img.rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${img.cx}" cy="${img.cy}"/></a:xfrm>` +
      `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
      `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
    );
  };

  const body: string[] = [docxPara(manifest.title, 'Title')];
  if (manifest.coverImageId) body.push(imgXml(manifest.coverImageId));
  if (opts.authorName) body.push(docxPara(opts.authorName));
  if (manifest.matter?.dedication) body.push(docxPara(`*${manifest.matter.dedication}*`));
  if (manifest.matter?.epigraph) body.push(docxPara(`*${manifest.matter.epigraph}*`));
  if (manifest.cast && manifest.cast.length > 0) {
    body.push(docxPara('The people in this book', 'Heading1'));
    for (const m of manifest.cast)
      body.push(docxPara(m.relationship ? `**${m.name}** — ${m.relationship}` : `**${m.name}**`));
  }
  for (const part of manifest.parts) {
    let first = true;
    for (const id of part.chapterIds) {
      const chapter = byId.get(id);
      if (!chapter) continue;
      if (first) body.push(docxPara(part.title, 'Heading1'));
      first = false;
      body.push(docxPara(chapter.title, 'Heading2'));
      const paras = chapterParagraphs(chapter.markdown);
      paras.forEach((para, i) => {
        body.push(docxPara(para.replace(/\n/g, ' ')));
        for (const pl of chapter.imagePlacements.filter((p) => p.afterAnchor === `p${i}`)) {
          const x = imgXml(pl.imageId);
          if (x) body.push(x);
          if (pl.caption) body.push(docxPara(`*${pl.caption}*`));
        }
      });
    }
  }
  if (manifest.matter?.acknowledgments) {
    body.push(docxPara('Acknowledgments', 'Heading1'));
    for (const p of manifest.matter.acknowledgments.split(/\n{2,}/))
      if (p.trim()) body.push(docxPara(p.trim()));
  }
  if (manifest.matter?.aboutAuthor) {
    body.push(docxPara('About the author', 'Heading1'));
    for (const p of manifest.matter.aboutAuthor.split(/\n{2,}/))
      if (p.trim()) body.push(docxPara(p.trim()));
  }
  if (manifest.chapterSources && manifest.chapterSources.length > 0) {
    body.push(docxPara('Sources', 'Heading1'));
    for (const cs of manifest.chapterSources) {
      const line = sourceLine(cs.counts);
      if (line) body.push(docxPara(`**${cs.title}** — drawn from ${line}`));
    }
  }
  if (manifest.noteOnBook) body.push(docxPara(`*${manifest.noteOnBook}*`));
  for (const line of colophonLines(manifest.matter)) body.push(docxPara(`*${line}*`));

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
    `<w:body>${body.join('')}<w:sectPr><w:pgSz w:w="8640" w:h="12960"/>` +
    `<w:pgMar w:top="1008" w:right="1008" w:bottom="1080" w:left="1008"/></w:sectPr></w:body></w:document>`;

  // Content types: default extensions (rels/xml + each image ext) + the document + styles overrides.
  const imgExts = [...new Set(imgs.map((i) => imageExt(i.mime)))];
  const imgMime = (ext: string): string =>
    ext === 'jpg'
      ? 'image/jpeg'
      : ext === 'png'
        ? 'image/png'
        : ext === 'webp'
          ? 'image/webp'
          : 'image/gif';
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    imgExts.map((e) => `<Default Extension="${e}" ContentType="${imgMime(e)}"/>`).join('') +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
    `</Types>`;

  const packageRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;

  const documentRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    imgs
      .map(
        (i) =>
          `<Relationship Id="${i.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${i.path}"/>`,
      )
      .join('') +
    `</Relationships>`;

  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: utf8(contentTypes) },
    { name: '_rels/.rels', data: utf8(packageRels) },
    { name: 'word/document.xml', data: utf8(documentXml) },
    { name: 'word/styles.xml', data: utf8(DOCX_STYLES) },
    { name: 'word/_rels/document.xml.rels', data: utf8(documentRels) },
    ...imgs.map((i) => ({ name: `word/${i.path}`, data: i.bytes })),
  ];
  return makeZip(entries);
}

/** Build the PUBLISHED head as a .docx — null if the book has never been published. */
export async function buildPublishedDocx(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<{ title: string; bytes: Uint8Array } | null> {
  const head = await readPublishedHead(fs, key, personId, bookId);
  if (!head) return null;
  const author = await getPerson(fs, key, personId);
  return {
    title: head.manifest.title,
    bytes: bookToDocx(head.manifest, head.chapters, head.images, {
      authorName: author?.displayName ?? '',
    }),
  };
}

/** Build the DRAFT head as a .docx (§13.6.1) — null before the book has an outline. */
export async function buildDraftDocx(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<{ title: string; bytes: Uint8Array } | null> {
  const head = await readDraftHead(fs, key, personId, bookId);
  if (!head) return null;
  const author = await getPerson(fs, key, personId);
  return {
    title: head.manifest.title,
    bytes: bookToDocx(head.manifest, head.chapters, head.images, {
      authorName: author?.displayName ?? '',
    }),
  };
}
