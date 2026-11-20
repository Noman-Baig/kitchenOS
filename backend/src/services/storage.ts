import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { config } from '../config.js';
import { exec, one, type Db, pool } from '../lib/db.js';
import { badRequest } from '../lib/errors.js';
import { uuid } from '../lib/crypto.js';

export const CATEGORIES = {
  'restaurant-logos': { visibility: 'public', image: true, maxDim: 1024, minDim: 64, thumb: 128 },
  'restaurant-banners': { visibility: 'public', image: true, maxDim: 2400, minDim: 400, thumb: 640 },
  'menu-images': { visibility: 'public', image: true, maxDim: 1600, minDim: 200, thumb: 400 },
  'gallery': { visibility: 'public', image: true, maxDim: 2000, minDim: 200, thumb: 480 },
  'platform-branding': { visibility: 'public', image: true, maxDim: 1024, minDim: 16, thumb: 128 },
  'payment-qr': { visibility: 'public', image: true, maxDim: 1200, minDim: 150, thumb: 300 },
  'customer-payment-proofs': { visibility: 'private', image: true, maxDim: 2400, minDim: 100, thumb: 400 },
  'subscription-payment-proofs': { visibility: 'private', image: true, maxDim: 2400, minDim: 100, thumb: 400 },
  'signatures': { visibility: 'private', image: true, maxDim: 1600, minDim: 50, thumb: 0 },
  'generated-pdfs': { visibility: 'private', image: false },
  'generated-reports': { visibility: 'private', image: false },
  'exports': { visibility: 'private', image: false },
  'temporary': { visibility: 'private', image: false },
  'backups': { visibility: 'private', image: false },
} as const;
export type Category = keyof typeof CATEGORIES;

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const EXT_BY_MIME: Record<string, string[]> = { 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'] };

export async function ensureStorageDirs() {
  for (const c of Object.keys(CATEGORIES)) await fs.mkdir(path.join(config.storage.dir, c), { recursive: true });
}

function keyFor(category: string, ext: string) {
  const d = new Date();
  return path.posix.join(category, `${d.getUTCFullYear()}`, String(d.getUTCMonth() + 1).padStart(2, '0'), `${uuid()}.${ext}`);
}

export const absPath = (key: string) => {
  const p = path.resolve(config.storage.dir, key);
  if (!p.startsWith(path.resolve(config.storage.dir) + path.sep)) throw badRequest('Invalid storage key');
  return p;
};

/**
 * Validate + normalise an uploaded image: checks declared MIME, sniffed magic bytes, extension and
 * pixel dimensions; strips metadata (EXIF/GPS), resizes and re-encodes to WebP; creates a thumbnail.
 * The user-supplied filename is never used on disk.
 */
export async function storeImageUpload(p: {
  buffer: Buffer; declaredMime: string; originalName: string; category: Category;
  restaurantId: number | null; userId?: number | null; ownerSessionId?: number | null; db?: Db;
}) {
  const cat = CATEGORIES[p.category];
  if (!cat || !cat.image) throw badRequest('Invalid upload category');
  if (p.buffer.length > config.storage.maxUploadMb * 1024 * 1024) throw badRequest(`File exceeds ${config.storage.maxUploadMb} MB`);
  const sniff = await fileTypeFromBuffer(p.buffer);
  if (!sniff || !IMAGE_MIMES.has(sniff.mime)) throw badRequest('Only JPEG, PNG or WebP images are accepted');
  if (!IMAGE_MIMES.has(p.declaredMime) || p.declaredMime !== sniff.mime) throw badRequest('File type does not match its content');
  const ext = (p.originalName.split('.').pop() || '').toLowerCase();
  if (!EXT_BY_MIME[sniff.mime].includes(ext)) throw badRequest('File extension does not match its content');
  let meta: sharp.Metadata;
  try { meta = await sharp(p.buffer, { limitInputPixels: 50_000_000 }).metadata(); } catch { throw badRequest('Image could not be decoded'); }
  const w = meta.width || 0, h = meta.height || 0;
  const minDim = Math.max(config.storage.imageMinDimension > cat.minDim ? cat.minDim : cat.minDim, 1);
  if (Math.min(w, h) < minDim) throw badRequest(`Image is too small: minimum ${minDim}px on the shortest side`);
  if (Math.max(w, h) > 12000) throw badRequest('Image dimensions are too large');
  const maxDim = Math.min(cat.maxDim, config.storage.imageMaxDimension);
  const key = keyFor(p.category, 'webp');
  const out = await sharp(p.buffer).rotate().resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
  await fs.mkdir(path.dirname(absPath(key)), { recursive: true });
  await fs.writeFile(absPath(key), out.data, { mode: 0o640 });
  let thumbKey: string | null = null;
  if (cat.thumb) {
    thumbKey = key.replace(/\.webp$/, '.thumb.webp');
    await sharp(out.data).resize({ width: cat.thumb, height: cat.thumb, fit: 'cover' }).webp({ quality: 75 }).toFile(absPath(thumbKey));
  }
  const publicId = uuid();
  const res = await exec(
    'INSERT INTO files (public_id, restaurant_id, category, storage_key, thumb_key, mime, size_bytes, width, height, visibility, owner_session_id, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [publicId, p.restaurantId, p.category, key, thumbKey, 'image/webp', out.info.size, out.info.width, out.info.height, cat.visibility, p.ownerSessionId ?? null, p.userId ?? null], p.db ?? pool);
  return { id: res.insertId, publicId, url: `/api/v1/files/${publicId}`, width: out.info.width, height: out.info.height };
}

/** Store a server-generated file (PDF/XLSX/JSON). */
export async function storeGenerated(p: { buffer: Buffer; mime: string; ext: string; category: Category; restaurantId: number | null; userId?: number | null; ttlHours?: number; db?: Db }) {
  const key = keyFor(p.category, p.ext);
  await fs.mkdir(path.dirname(absPath(key)), { recursive: true });
  await fs.writeFile(absPath(key), p.buffer, { mode: 0o640 });
  const publicId = uuid();
  const expires = p.ttlHours ? new Date(Date.now() + p.ttlHours * 3600000) : null;
  const res = await exec('INSERT INTO files (public_id, restaurant_id, category, storage_key, mime, size_bytes, visibility, created_by, expires_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [publicId, p.restaurantId, p.category, key, p.mime, p.buffer.length, 'private', p.userId ?? null, expires], p.db ?? pool);
  return { id: res.insertId, publicId };
}

export async function storeDataUrlImage(dataUrl: string, category: Category, restaurantId: number | null, db?: Db) {
  const m = /^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) throw badRequest('Invalid image data');
  const buffer = Buffer.from(m[3], 'base64');
  return storeImageUpload({ buffer, declaredMime: m[1], originalName: `upload.${m[2] === 'jpeg' ? 'jpg' : m[2]}`, category, restaurantId, db });
}

export async function getFileRow(publicId: string) {
  if (!/^[0-9a-f-]{36}$/.test(publicId)) return null;
  return one<any>('SELECT * FROM files WHERE public_id=?', [publicId]);
}

export async function readFileBuffer(key: string) {
  return fs.readFile(absPath(key));
}

export const fileExists = (key: string) => fssync.existsSync(absPath(key));

export async function deleteStoredFile(row: { storage_key: string; thumb_key?: string | null }) {
  for (const k of [row.storage_key, row.thumb_key]) {
    if (!k) continue;
    try { await fs.unlink(absPath(k)); } catch { /* already gone */ }
  }
}

export async function fileIdFromPublic(publicId: string | null | undefined, restaurantId: number | null, db: Db = pool) {
  if (!publicId) return null;
  const f = await one<any>('SELECT id, restaurant_id FROM files WHERE public_id=?', [publicId], db);
  if (!f) throw badRequest('Unknown file');
  if (restaurantId !== null && f.restaurant_id !== null && f.restaurant_id !== restaurantId) throw badRequest('Unknown file');
  return f.id as number;
}
