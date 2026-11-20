import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { localRangeToUtc, tzOffsetMinutes } from '../../src/services/reports.js';
import { canTransition } from '../../src/services/orders.js';
import { hasPermission, DEFAULT_ROLES } from '../../src/lib/permissions.js';
import { signFileUrl, verifyFileSignature } from '../../src/lib/crypto.js';
import { encodeCodePage, receiptEscPos, receiptText } from '../../src/services/documents.js';

describe('timezone ranges', () => {
  it('computes offsets including half-hour zones', () => {
    expect(tzOffsetMinutes('Asia/Karachi', new Date('2026-01-01T00:00:00Z'))).toBe(300);
    expect(tzOffsetMinutes('Asia/Kolkata', new Date('2026-01-01T00:00:00Z'))).toBe(330);
    expect(tzOffsetMinutes('America/New_York', new Date('2026-07-01T00:00:00Z'))).toBe(-240);
  });
  it('maps a local custom day to a UTC half-open range', () => {
    const r = localRangeToUtc('Asia/Dubai', 'custom', '2026-03-10', '2026-03-10');
    expect(r.from.toISOString()).toBe('2026-03-09T20:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-03-10T20:00:00.000Z');
  });
  it('rejects inverted ranges', () => {
    expect(() => localRangeToUtc('UTC', 'custom', '2026-03-10', '2026-03-01')).toThrow();
  });
});

describe('order state machine', () => {
  it('allows only valid transitions', () => {
    expect(canTransition('pending_approval', 'accepted')).toBe(true);
    expect(canTransition('completed', 'cancelled')).toBe(false);
    expect(canTransition('rejected', 'accepted')).toBe(false);
    expect(canTransition('ready', 'served')).toBe(true);
  });
});

describe('permissions', () => {
  it('waiter role has least privilege', () => {
    const waiter = DEFAULT_ROLES.find((r) => r.key === 'waiter')!.permissions as string[];
    expect(hasPermission(waiter, 'payroll.manage')).toBe(false);
    expect(hasPermission(waiter, 'staff.manage')).toBe(false);
    expect(hasPermission(waiter, 'waiter.use')).toBe(true);
    expect(hasPermission(['*'], 'payroll.manage')).toBe(true);
  });
});

describe('signed file URLs', () => {
  it('verifies and expires', () => {
    const url = new URL('http://x' + signFileUrl('11111111-1111-1111-1111-111111111111', 60));
    expect(verifyFileSignature('11111111-1111-1111-1111-111111111111', url.searchParams.get('exp')!, url.searchParams.get('sig')!)).toBe(true);
    expect(verifyFileSignature('22222222-2222-2222-2222-222222222222', url.searchParams.get('exp')!, url.searchParams.get('sig')!)).toBe(false);
    expect(verifyFileSignature('11111111-1111-1111-1111-111111111111', String(Math.floor(Date.now() / 1000) - 5), url.searchParams.get('sig')!)).toBe(false);
  });
});

describe('PEM platform signing', () => {
  it('signs and verifies with an Ed25519 key, and rejects tampering', async () => {
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    const p = path.join(os.tmpdir(), `umema-test-${Date.now()}.pem`);
    fs.writeFileSync(p, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    process.env.PLATFORM_SIGNING_KEY_PATH = p;
    const { config } = await import('../../src/config.js');
    (config.security as any).platformSigningKeyPath = p;
    const { signArtifact, verifyArtifact } = await import('../../src/lib/crypto.js');
    const hash = crypto.createHash('sha256').update('agreement').digest('hex');
    const s = signArtifact(hash)!;
    expect(s).not.toBeNull();
    expect(verifyArtifact(hash, s.signature, s.keyId)).toBe(true);
    const other = crypto.createHash('sha256').update('tampered').digest('hex');
    expect(verifyArtifact(other, s.signature, s.keyId)).toBe(false);
    fs.unlinkSync(p);
  });
});

describe('receipts', () => {
  const d = { restaurant: { name: 'Test Café', address: 'Main St', phone: '123' }, billNo: 'B1', dateText: '2026-01-01', orderType: 'dine_in', currency: 'USD',
    lines: [{ name: 'Café latte', qty: 2, unit: '3.5', total: '7' }], subtotal: '7', discount: '0', taxes: [{ name: 'VAT', rate: '5', amount: '0.35', inclusive: false }], deliveryCharge: '0', total: '7.35', paid: '7.35', balance: '0', payments: [{ method: 'cash', amount: '7.35' }], footer: 'Thanks', poweredBy: 'umemaai_undated_version' };
  it('fits the configured width and lists taxes separately', () => {
    const t = receiptText(d, 32);
    expect(t.split('\n').every((l) => l.length <= 32)).toBe(true);
    expect(t).toContain('VAT 5%');
    expect(receiptText(d, 48)).toContain('Powered by umemaai_undated_version');
  });
  it('produces ESC/POS with init and cut commands', () => {
    const b = receiptEscPos(d, 32);
    expect([...b.subarray(0, 2)]).toEqual([0x1b, 0x40]);
    expect([...b.subarray(b.length - 4)]).toEqual([0x1d, 0x56, 0x42, 0x00]);
    expect([...b.subarray(2, 5)]).toEqual([0x1b, 0x74, 0]); // code page select
  });
  it('maps accented Latin text to the printer code page and appends the drawer kick', () => {
    expect([...encodeCodePage('Café ñ', 'cp437')]).toEqual([0x43, 0x61, 0x66, 0x82, 0x20, 0xa4]);
    expect([...encodeCodePage('€5', 'cp858')]).toEqual([0xd5, 0x35]);
    expect([...encodeCodePage('Ā', 'cp437')]).toEqual([0x41]); // transliterated
    expect([...encodeCodePage('ک', 'cp437')]).toEqual([0x3f]);
    const b = receiptEscPos(d, 32, 'cp858', { openDrawer: true });
    expect([...b.subarray(b.length - 5)]).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
  });
});
