import { decodeFileName, humanFileName } from './file-helpers';

describe('file helpers', () => {
  describe('decodeFileName', () => {
    it('decodes URI-encoded Cyrillic file names', () => {
      expect(decodeFileName('%D0%A1%D1%82%D1%83%D0%B4%D0%B5%D0%BD%D1%82.pdf')).toBe('Студент.pdf');
    });

    it('keeps malformed percent signs while decoding valid byte runs', () => {
      expect(decodeFileName('%D0%A4%D0%B0%D0%B9%D0%BB%20100%.pdf')).toBe('Файл 100%.pdf');
    });
  });

  describe('humanFileName', () => {
    it('decodes file names from chat content markers', () => {
      expect(humanFileName('[Файл: %D0%94%D0%BE%D0%BA%D1%83%D0%BC%D0%B5%D0%BD%D1%82.pdf]', null)).toBe('Документ.pdf');
    });

    it('decodes file names extracted from URLs', () => {
      expect(humanFileName(null, 'https://storage.example/chat/%D0%97%D0%B0%D1%8F%D0%B2%D0%BA%D0%B0.docx?X-Amz-Signature=1')).toBe('Заявка.docx');
    });
  });
});
