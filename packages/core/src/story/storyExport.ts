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
