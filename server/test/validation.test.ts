import { describe, expect, it } from 'vitest';
import { sanitizeFilename, validateFile } from '../src/pipeline/validate.js';

const MB = 1024 * 1024;
const file = (originalname: string, content: Buffer | string, mimetype = '') => {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return { originalname, mimetype, size: buffer.length, buffer };
};

describe('file validation', () => {
  it('accepts a genuine text file and a genuine PDF header', () => {
    expect(validateFile(file('notes.txt', 'Name: Test', 'text/plain'), MB)).toMatchObject({ ok: true, kind: 'text' });
    expect(validateFile(file('form.pdf', '%PDF-1.4\n...', 'application/pdf'), MB)).toMatchObject({ ok: true, kind: 'pdf' });
  });

  it('rejects a text file renamed to .pdf (magic-byte check)', () => {
    expect(validateFile(file('fake.pdf', 'just text', 'application/pdf'), MB)).toMatchObject({ ok: false, code: 'CONTENT_MISMATCH' });
  });

  it('rejects unsupported, empty, oversized and MIME-mismatched files', () => {
    expect(validateFile(file('virus.exe', 'MZ...'), MB)).toMatchObject({ ok: false, code: 'UNSUPPORTED_TYPE' });
    expect(validateFile(file('empty.txt', ''), MB)).toMatchObject({ ok: false, code: 'EMPTY_FILE' });
    expect(validateFile(file('big.txt', 'x'.repeat(2048)), 1024)).toMatchObject({ ok: false, code: 'FILE_TOO_LARGE' });
    expect(validateFile(file('a.csv', 'a,b\n1,2', 'image/png'), MB)).toMatchObject({ ok: false, code: 'MIME_MISMATCH' });
  });

  it('rejects binary content disguised as text', () => {
    expect(validateFile(file('data.txt', Buffer.from([0x00, 0x01, 0x02, 0xff])), MB)).toMatchObject({ ok: false });
  });

  it('sanitises path traversal and control characters out of filenames', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('..\\..\\windows\\evil.pdf')).toBe('evil.pdf');
    expect(sanitizeFilename('in\u0000voice<script>.pdf')).toBe('invoice_script_.pdf');
  });
});
