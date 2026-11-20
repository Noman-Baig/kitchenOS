import { exec, type Db } from '../lib/db.js';
import { sha256, signArtifact } from '../lib/crypto.js';
import { agreementPdf } from './documents.js';
import { getBranding } from './settings.js';
import { storeDataUrlImage, storeGenerated, readFileBuffer } from './storage.js';
import { one } from '../lib/db.js';

/** Records an electronic acceptance: signature image, tamper-evident hash, optional platform PEM signature, signed PDF. */
export async function acceptAgreement(db: Db, p: {
  restaurantId: number; agreement: any; signerName: string; signerTitle: string | null; signerEmail: string;
  signatureDataUrl: string; ip: string | null; userAgent: string | null; restaurantName: string;
}) {
  const sig = await storeDataUrlImage(p.signatureDataUrl, 'signatures', p.restaurantId, db);
  const signedAt = new Date();
  const hash = sha256(JSON.stringify({
    agreementVersion: p.agreement.version, agreementBodySha256: sha256(p.agreement.body), restaurantId: p.restaurantId,
    signerName: p.signerName, signerTitle: p.signerTitle, signerEmail: p.signerEmail, signedAt: signedAt.toISOString(), signatureFile: sig.publicId,
  }));
  const platformSig = signArtifact(hash);
  const b = await getBranding();
  const sigRow = await one<any>('SELECT storage_key FROM files WHERE id=?', [sig.id], db);
  const pdf = await agreementPdf({
    softwareName: b.softwareName, agreementTitle: p.agreement.title, version: p.agreement.version, body: p.agreement.body, restaurantName: p.restaurantName,
    signerName: p.signerName, signerTitle: p.signerTitle, signerEmail: p.signerEmail, signedAt, ip: p.ip, contentHash: hash,
    signaturePng: await readFileBuffer(sigRow.storage_key), platformSignature: platformSig?.signature, keyId: platformSig?.keyId,
  });
  const pdfFile = await storeGenerated({ buffer: pdf, mime: 'application/pdf', ext: 'pdf', category: 'generated-pdfs', restaurantId: p.restaurantId, db });
  const res = await exec(
    `INSERT INTO agreement_acceptances (restaurant_id, agreement_id, signer_name, signer_title, signer_email, signature_file_id, pdf_file_id, content_hash, platform_signature, signing_key_id, ip_address, user_agent, signed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [p.restaurantId, p.agreement.id, p.signerName, p.signerTitle, p.signerEmail, sig.id, pdfFile.id, hash, platformSig?.signature ?? null, platformSig?.keyId ?? null, p.ip, (p.userAgent || '').slice(0, 400), signedAt], db);
  return { id: res.insertId, hash, pdfPublicId: pdfFile.publicId };
}
