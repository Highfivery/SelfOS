import { describe, expect, it } from 'vitest';
import { buildResultsExport, exportMimeType, type ExportSend } from './resultsExport';

const sends: ExportSend[] = [
  {
    recipientName: 'Mara',
    status: 'submitted',
    privacy: 'standard',
    submittedAt: '2026-06-23T10:00:00.000Z',
    answers: [
      { prompt: 'How are we doing?', answer: 'Doing well, thanks' },
      { prompt: 'Rate it', answer: '4' },
    ],
  },
  {
    recipientName: 'Someone',
    status: 'sent',
    privacy: 'standard',
    answers: [],
  },
];

describe('buildResultsExport (38 §3.7)', () => {
  it('produces a CSV with a header and one row per answer', () => {
    const csv = buildResultsExport('Weekly check-in', sends, 'csv');
    expect(csv).toContain('# Weekly check-in');
    expect(csv).toContain('Recipient,Status,Submitted,Question,Answer');
    // The answer with a comma is quoted; the recipient + status lead the row.
    expect(csv).toContain(
      'Mara,submitted,2026-06-23T10:00:00.000Z,How are we doing?,"Doing well, thanks"',
    );
    // A send with no exportable answers still appears as a row.
    expect(csv).toContain('Someone,sent,,,');
    expect(exportMimeType('csv')).toBe('text/csv');
  });

  it('escapes commas/quotes/newlines per RFC 4180', () => {
    const csv = buildResultsExport(
      'T',
      [
        {
          recipientName: 'A',
          status: 'submitted',
          privacy: 'standard',
          answers: [{ prompt: 'Q', answer: 'has "quotes", and, commas' }],
        },
      ],
      'csv',
    );
    expect(csv).toContain('"has ""quotes"", and, commas"');
  });

  it('produces JSON with the title + sends', () => {
    const json = JSON.parse(buildResultsExport('Weekly check-in', sends, 'json'));
    expect(json.title).toBe('Weekly check-in');
    expect(json.sends).toHaveLength(2);
    expect(json.sends[0].answers[0]).toEqual({
      prompt: 'How are we doing?',
      answer: 'Doing well, thanks',
    });
    expect(exportMimeType('json')).toBe('application/json');
  });
});
