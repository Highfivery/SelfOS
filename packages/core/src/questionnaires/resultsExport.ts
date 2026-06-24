/**
 * Pure builder for exporting a questionnaire's results to CSV or JSON (38 §3.7). Runs over an already
 * privacy-filtered set of sends (the bridge is the trust boundary: it includes a Private send's NUMERIC
 * answers only, never its prose — exactly as the Results view does), so this formatter can never widen the
 * boundary. CSV uses a long shape (one row per answer) so it's robust to per-send variant questions.
 */
export type ExportFormat = 'csv' | 'json';

export interface ExportAnswer {
  prompt: string;
  answer: string;
}

export interface ExportSend {
  recipientName: string;
  status: string;
  privacy: string;
  submittedAt?: string;
  answers: ExportAnswer[];
}

/** MIME type for a given export format (text/csv vs application/json). */
export function exportMimeType(format: ExportFormat): string {
  return format === 'csv' ? 'text/csv' : 'application/json';
}

/** Escape a CSV field per RFC 4180 — quote when it contains a comma, quote, or newline; double inner quotes. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(title: string, sends: ExportSend[]): string {
  const rows: string[] = [['Recipient', 'Status', 'Submitted', 'Question', 'Answer'].join(',')];
  for (const send of sends) {
    const submitted = send.submittedAt ?? '';
    if (send.answers.length === 0) {
      // A send with no (exportable) answers still gets a row so it's visible in the export.
      rows.push([send.recipientName, send.status, submitted, '', ''].map(csvField).join(','));
      continue;
    }
    for (const a of send.answers) {
      rows.push(
        [send.recipientName, send.status, submitted, a.prompt, a.answer].map(csvField).join(','),
      );
    }
  }
  // A leading title comment row keeps the CSV self-describing without breaking the header.
  return [`# ${title}`, ...rows].join('\r\n');
}

function toJson(title: string, sends: ExportSend[]): string {
  return JSON.stringify({ title, sends }, null, 2);
}

/** Build the export text for a questionnaire's results in the chosen format. */
export function buildResultsExport(
  title: string,
  sends: ExportSend[],
  format: ExportFormat,
): string {
  return format === 'csv' ? toCsv(title, sends) : toJson(title, sends);
}
