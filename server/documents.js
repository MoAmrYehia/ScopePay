// Uploaded files: decode, validate type and size, extract text from documents.

import { extractText, getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';

export const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const DOC_TYPES = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
  'text/markdown': 'md',
};
export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

export function decodeUpload({ filename, mime, base64 }) {
  if (typeof filename !== 'string' || typeof base64 !== 'string') throw badRequest('A file name and file contents are required.');
  const type = guessMime(filename, mime);
  if (!IMAGE_TYPES.has(type) && !DOC_TYPES[type]) throw badRequest('Upload a PNG, JPG, WebP, PDF, DOCX, TXT or MD file.');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw badRequest('The file is empty.');
  if (buffer.length > MAX_UPLOAD_BYTES) throw badRequest('Files must be 6 MB or smaller.');
  return { filename: filename.replace(/[^\w .()-]/g, '_').slice(0, 120), mime: type, buffer };
}

export async function documentText({ mime, buffer }) {
  const kind = DOC_TYPES[mime];
  if (kind === 'pdf') {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  }
  if (kind === 'docx') return (await mammoth.extractRawText({ buffer })).value;
  if (kind === 'txt' || kind === 'md') return buffer.toString('utf8');
  return '';
}

function guessMime(filename, mime) {
  const ext = filename.toLowerCase().split('.').pop();
  const byExt = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain', md: 'text/markdown' };
  return byExt[ext] || mime || '';
}

export function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}
