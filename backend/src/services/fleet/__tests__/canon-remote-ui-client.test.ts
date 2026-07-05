import { describe, it, expect } from 'vitest';

import { parseJobLogHtml } from '../canon-remote-ui-client.js';

// Minimal-but-realistic fixture. Row 0 is the JS-polluted header row Canon
// firmware emits; we expect the parser to skip it. Rows 1-3 are real jobs.
const SAMPLE_JLP_HTML = `<html><body>
<table class="joblog">
  <tr>
    <td>NO.</td><td>TYPE</td><td>START TIME</td><td>END TIME</td>
    <td>RESULT</td><td>MODE</td><td>NAME</td><td>USER</td>
    <td>DEST</td><td>PAGES</td><td>COPIES</td><td>STATUS</td>
  </tr>
  <tr>
    <td>9735</td><td>Print</td>
    <td>20/04 2006 16:42:19</td>
    <td>20/04 2006 16:43:00</td>
    <td></td><td></td>
    <td>IDs-2026-04-20-pass.pdf</td>
    <td>rostv</td>
    <td></td>
    <td>50</td>
    <td>1 x 50</td>
    <td>OK</td>
  </tr>
  <tr>
    <td>9734</td><td>Copy</td>
    <td>20/04 2006 16:30:00</td>
    <td>20/04 2006 16:30:05</td>
    <td></td><td></td>
    <td></td>
    <td>info</td>
    <td></td>
    <td>1</td>
    <td>24 x 1</td>
    <td>ERROR</td>
  </tr>
  <tr>
    <td>9733</td><td>Print</td>
    <td>20/04 2006 16:15:00</td>
    <td>20/04 2006 16:15:02</td>
    <td></td><td></td>
    <td>report.docx</td>
    <td>info</td>
    <td></td>
    <td>2</td>
    <td>1 x 2</td>
    <td>CANCEL</td>
  </tr>
</table>
</body></html>`;

describe('parseJobLogHtml', () => {
  it('parses multiple rows and skips the header row', () => {
    const rows = parseJobLogHtml(SAMPLE_JLP_HTML);
    expect(rows).toHaveLength(3);

    expect(rows[0]).toMatchObject({
      canon_job_id: '9735',
      start_time_local: '20/04 2006 16:42:19',
      end_time_local: '20/04 2006 16:43:00',
      document_name: 'IDs-2026-04-20-pass.pdf',
      user: 'rostv',
      pages: 50,
      copies_x_pages: '1 x 50',
      status: 'OK',
    });
    expect(rows[1]).toMatchObject({
      canon_job_id: '9734',
      pages: 1,
      copies_x_pages: '24 x 1',
      status: 'ERROR',
      user: 'info',
    });
    expect(rows[2]).toMatchObject({
      canon_job_id: '9733',
      document_name: 'report.docx',
      pages: 2,
      copies_x_pages: '1 x 2',
      status: 'CANCEL',
    });
  });

  it('skips malformed rows (non-numeric col0 / JS-polluted header)', () => {
    const html = `<table>
      <tr><td>ID</td><td>a</td><td>b</td><td>c</td><td>d</td><td>e</td><td>f</td><td>g</td><td>h</td><td>i</td><td>j</td><td>k</td></tr>
      <tr>
        <td>var foo=1;</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td>
      </tr>
      <tr>
        <td>1234</td><td>Print</td>
        <td>21/04 2006 12:00:00</td>
        <td>21/04 2006 12:00:01</td>
        <td></td><td></td>
        <td>doc.pdf</td>
        <td>info</td>
        <td></td>
        <td>3</td>
        <td>1 x 3</td>
        <td>OK</td>
      </tr>
    </table>`;
    const rows = parseJobLogHtml(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.canon_job_id).toBe('1234');
  });

  it('returns empty array when rows have insufficient column count', () => {
    const html = `<table>
      <tr><td>1</td><td>2</td><td>3</td></tr>
      <tr><td>42</td><td>Print</td><td>21/04 2006 12:00:00</td></tr>
    </table>`;
    const rows = parseJobLogHtml(html);
    expect(rows).toEqual([]);
  });

  it('returns empty array for empty HTML', () => {
    expect(parseJobLogHtml('')).toEqual([]);
    expect(parseJobLogHtml('<html></html>')).toEqual([]);
    expect(parseJobLogHtml('<html><body>no table</body></html>')).toEqual([]);
  });

  it('returns empty array for HTML without numeric job ids', () => {
    const html = `<table>
      <tr><td>abc</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>5</td><td>1 x 5</td><td>OK</td></tr>
      <tr><td></td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>1</td><td>1 x 1</td><td>OK</td></tr>
    </table>`;
    expect(parseJobLogHtml(html)).toEqual([]);
  });
});
