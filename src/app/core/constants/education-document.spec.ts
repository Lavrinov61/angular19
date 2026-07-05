import { describe, expect, it } from 'vitest';
import {
  EDUCATION_DOCUMENT_HINTS,
  EDUCATION_ROLE_OPTIONS,
  MAX_DOCUMENT_FILE_SIZE,
  validateEducationDocumentFile,
} from './education-document';

describe('validateEducationDocumentFile', () => {
  it('accepts a valid jpeg under the size limit', () => {
    const file = new File([new Uint8Array(10)], 'a.jpg', { type: 'image/jpeg' });

    const result = validateEducationDocumentFile(file);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.file).toBe(file);
    }
  });

  it('rejects an unsupported mime type with the cabinet copy', () => {
    const file = new File([new Uint8Array(10)], 'doc.pdf', { type: 'application/pdf' });

    const result = validateEducationDocumentFile(file);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe('Загрузите фото в формате JPEG, PNG, WEBP или HEIC.');
    }
  });

  it('rejects a file above the 12 MB limit with the cabinet copy', () => {
    const file = new File([new Uint8Array(13 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });

    expect(file.size).toBeGreaterThan(MAX_DOCUMENT_FILE_SIZE);

    const result = validateEducationDocumentFile(file);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe('Файл должен быть не больше 12 МБ.');
    }
  });
});

describe('education role options', () => {
  it('lists exactly five roles', () => {
    expect(EDUCATION_ROLE_OPTIONS).toHaveLength(5);
  });

  it('covers every key of EDUCATION_DOCUMENT_HINTS with a non-empty hint', () => {
    const optionValues = EDUCATION_ROLE_OPTIONS.map((option) => option.value).sort();
    const hintKeys = Object.keys(EDUCATION_DOCUMENT_HINTS).sort();

    expect(optionValues).toEqual(hintKeys);

    for (const option of EDUCATION_ROLE_OPTIONS) {
      expect(EDUCATION_DOCUMENT_HINTS[option.value].trim().length).toBeGreaterThan(0);
    }
  });
});
