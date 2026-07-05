import { describe, it, expect } from 'vitest';

import {
  parseCupsPageLogLine,
  parseCupsTimestamp,
  CUPS_PAGE_LOG_REGEX,
} from '../cups-page-log-parser.service.js';

describe('CUPS_PAGE_LOG_REGEX', () => {
  it('is exported and compiled', () => {
    expect(CUPS_PAGE_LOG_REGEX).toBeInstanceOf(RegExp);
  });
});

describe('parseCupsTimestamp', () => {
  it('parses standard CUPS timestamp with timezone', () => {
    const d = parseCupsTimestamp('21/Apr/2026:21:22:59 +0300');
    expect(d).not.toBeNull();
    expect(d?.toISOString()).toBe(new Date('2026-04-21T21:22:59+03:00').toISOString());
  });

  it('returns null for malformed timestamps', () => {
    expect(parseCupsTimestamp('not a timestamp')).toBeNull();
    expect(parseCupsTimestamp('2026-04-21 21:22:59')).toBeNull();
    expect(parseCupsTimestamp('')).toBeNull();
  });
});

describe('parseCupsPageLogLine', () => {
  it('parses a standard line with all fields populated', () => {
    const line = 'Canon-C3226i-Soborny rostv 12 [21/Apr/2026:21:22:59 +0300] 1 1 1 1 "test.txt" A4 one-sided';
    const parsed = parseCupsPageLogLine(line);

    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      printerName: 'Canon-C3226i-Soborny',
      username: 'rostv',
      cupsJobId: '12',
      pageNum: 1,
      copies: 1,
      impressionsCompleted: 1,
      mediaSheetsCompleted: 1,
      jobName: 'test.txt',
      media: 'A4',
      sides: 'one-sided',
      duplex: false,
    });
    expect(parsed?.timestamp.toISOString()).toBe(new Date('2026-04-21T21:22:59+03:00').toISOString());
  });

  it('treats "-" for impressions/sheet counters as null', () => {
    const line = 'Epson-L8050-Left-Soborny rostv 15 [21/Apr/2026:22:05:10 +0300] 1 1 - - "photo.jpg" 10x15 one-sided';
    const parsed = parseCupsPageLogLine(line);

    expect(parsed).not.toBeNull();
    expect(parsed?.impressionsCompleted).toBeNull();
    expect(parsed?.mediaSheetsCompleted).toBeNull();
    expect(parsed?.jobName).toBe('photo.jpg');
    expect(parsed?.media).toBe('10x15');
  });

  it('handles job names containing spaces inside quotes', () => {
    const line = 'Canon-C3226i-Soborny admin 99 [10/Jan/2026:09:00:00 +0000] 2 1 2 2 "My Important Document.pdf" A3 one-sided';
    const parsed = parseCupsPageLogLine(line);

    expect(parsed).not.toBeNull();
    expect(parsed?.jobName).toBe('My Important Document.pdf');
    expect(parsed?.pageNum).toBe(2);
    expect(parsed?.media).toBe('A3');
  });

  it('recognises two-sided-long-edge as duplex=true', () => {
    const line = 'Canon-C3226i-Soborny rostv 42 [05/Feb/2026:12:30:00 +0300] 3 1 3 2 "draft.pdf" A4 two-sided-long-edge';
    const parsed = parseCupsPageLogLine(line);

    expect(parsed).not.toBeNull();
    expect(parsed?.sides).toBe('two-sided-long-edge');
    expect(parsed?.duplex).toBe(true);
  });

  it('recognises two-sided-short-edge as duplex=true', () => {
    const line = 'Canon-C3226i-Soborny rostv 43 [05/Feb/2026:12:31:00 +0300] 1 1 1 1 "x.pdf" A4 two-sided-short-edge';
    const parsed = parseCupsPageLogLine(line);

    expect(parsed?.duplex).toBe(true);
  });

  it('keeps duplex=false for one-sided', () => {
    const line = 'Canon-C3226i-Soborny rostv 44 [05/Feb/2026:12:32:00 +0300] 1 1 1 1 "x.pdf" A4 one-sided';
    const parsed = parseCupsPageLogLine(line);

    expect(parsed?.duplex).toBe(false);
  });

  it('accepts unquoted sentinel job-name (e.g. NONE) without breaking parse', () => {
    const line = 'Canon-C3226i-Soborny rostv 77 [21/Apr/2026:21:22:59 +0300] 1 1 1 1 NONE A4 one-sided';
    const parsed = parseCupsPageLogLine(line);

    expect(parsed).not.toBeNull();
    expect(parsed?.printerName).toBe('Canon-C3226i-Soborny');
    expect(parsed?.cupsJobId).toBe('77');
    expect(parsed?.jobName).toBeNull();
    expect(parsed?.media).toBe('A4');
    expect(parsed?.sides).toBe('one-sided');
  });

  it('returns null for malformed lines without throwing', () => {
    expect(parseCupsPageLogLine('')).toBeNull();
    expect(parseCupsPageLogLine('   ')).toBeNull();
    expect(parseCupsPageLogLine('garbage not matching anything')).toBeNull();
    expect(parseCupsPageLogLine('Canon rostv NOT_A_NUMBER [21/Apr/2026:21:22:59 +0300] 1 1 1 1 "x" A4 one-sided')).toBeNull();
    expect(parseCupsPageLogLine('Canon rostv 1 [invalid-ts] 1 1 1 1 "x" A4 one-sided')).toBeNull();
  });

  it('returns null for non-string inputs', () => {
    expect(parseCupsPageLogLine(undefined as unknown as string)).toBeNull();
    expect(parseCupsPageLogLine(null as unknown as string)).toBeNull();
  });

  it('trims trailing whitespace / CRLF', () => {
    const line = 'Canon-C3226i-Soborny rostv 12 [21/Apr/2026:21:22:59 +0300] 1 1 1 1 "t.txt" A4 one-sided\r\n';
    const parsed = parseCupsPageLogLine(line);

    expect(parsed).not.toBeNull();
    expect(parsed?.jobName).toBe('t.txt');
  });

  it('treats "-" in media field as null (missing)', () => {
    const line = 'Canon-C3226i-Soborny rostv 55 [21/Apr/2026:21:22:59 +0300] 1 1 1 1 "x" - one-sided';
    const parsed = parseCupsPageLogLine(line);

    expect(parsed).not.toBeNull();
    expect(parsed?.media).toBeNull();
  });
});
