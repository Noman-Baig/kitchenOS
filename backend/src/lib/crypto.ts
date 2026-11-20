import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from '../config.js';

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (v: string | Buffer) => crypto.createHash('sha256').update(v).digest('hex');
export const uuid = () => crypto.randomUUID();
export const randomPin = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Short-lived signed URL tokens for private file downloads. */
export function signFileUrl(publicId: string, ttlSeconds = 300) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = crypto.createHmac('sha256', config.security.fileSigningSecret).update(`${publicId}.${exp}`).digest('base64url');
  return `/api/v1/files/${publicId}?exp=${exp}&sig=${sig}`;
}
export function verifyFileSignature(publicId: string, exp: string, sig: string) {
  const e = Number(exp);
  if (!Number.isFinite(e) || e < Date.now() / 1000) return false;
  const expected = crypto.createHmac('sha256', config.security.fileSigningSecret).update(`${publicId}.${e}`).digest('base64url');
  return safeEqual(expected, sig);
}

/**
 * Optional PEM-based platform signing (Ed25519 or ECDSA P-256 recommended).
 * The private key is read from disk on the server only; it is never sent to clients or logged.
 */
let cachedKey: crypto.KeyObject | null | undefined;
export function platformSigningKey(): crypto.KeyObject | null {
  if (cachedKey !== undefined) return cachedKey;
  const p = config.security.platformSigningKeyPath;
  if (!p) return (cachedKey = null);
  try {
    cachedKey = crypto.createPrivateKey(fs.readFileSync(p));
  } catch {
    cachedKey = null;
  }
  return cachedKey;
}

export function signArtifact(hashHex: string): { signature: string; keyId: string } | null {
  const key = platformSigningKey();
  if (!key) return null;
  const alg = key.asymmetricKeyType === 'ed25519' || key.asymmetricKeyType === 'ed448' ? null : 'sha256';
  const signature = crypto.sign(alg, Buffer.from(hashHex, 'hex'), key).toString('base64');
  return { signature, keyId: config.security.platformSigningKeyId };
}

/** Verify with the current key's public half, or with an archived public key (rotation) in PLATFORM_PUBLIC_KEYS_DIR/<keyId>.pem */
export function verifyArtifact(hashHex: string, signatureB64: string, keyId: string): boolean {
  let pub: crypto.KeyObject | null = null;
  const dir = config.security.platformPublicKeysDir;
  if (dir && /^[A-Za-z0-9._-]+$/.test(keyId) && fs.existsSync(`${dir}/${keyId}.pem`)) {
    if (fs.existsSync(`${dir}/${keyId}.revoked`)) return false;
    pub = crypto.createPublicKey(fs.readFileSync(`${dir}/${keyId}.pem`));
  } else if (keyId === config.security.platformSigningKeyId) {
    const k = platformSigningKey();
    if (k) pub = crypto.createPublicKey(k);
  }
  if (!pub) return false;
  const alg = pub.asymmetricKeyType === 'ed25519' || pub.asymmetricKeyType === 'ed448' ? null : 'sha256';
  return crypto.verify(alg, Buffer.from(hashHex, 'hex'), pub, Buffer.from(signatureB64, 'base64'));
}

/** TURN REST API credentials (coturn `use-auth-secret`). */
export function turnCredentials(identity: string) {
  const { turnSecret, turnTtlSeconds } = config.webrtc;
  if (!turnSecret) return null;
  const username = `${Math.floor(Date.now() / 1000) + turnTtlSeconds}:${identity}`;
  const credential = crypto.createHmac('sha1', turnSecret).update(username).digest('base64');
  return { username, credential };
}
