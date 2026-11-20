import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { exec, q, toJson, type Db, pool } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { emit, rooms } from '../realtime/bus.js';
import { getBranding } from './settings.js';

let transporter: nodemailer.Transporter | null | undefined;
function mailer() {
  if (transporter !== undefined) return transporter;
  if (!config.smtp.host) return (transporter = null);
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return transporter;
}

export const emailEnabled = () => !!config.smtp.host;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Sends a branded email. Never throws: core operations must work without SMTP. */
export async function sendEmail(to: string | string[], subject: string, text: string, opts: { restaurantName?: string } = {}) {
  const t = mailer();
  if (!t) return false;
  const b = await getBranding();
  const from = config.smtp.from || `${b.emailSenderName} <${b.emailSenderAddress || b.supportEmail}>`;
  const heading = opts.restaurantName || b.softwareName;
  const html = `<!doctype html><html><body style="margin:0;background:#f5f5f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;border:1px solid #e7e5e4">
<tr><td style="padding:24px 28px;border-bottom:3px solid ${esc(b.primaryColor)}"><strong style="font-size:18px;color:#111">${esc(heading)}</strong></td></tr>
<tr><td style="padding:28px;color:#292524;font-size:15px;line-height:1.6">${esc(text).replace(/\n/g, '<br>')}</td></tr>
<tr><td style="padding:16px 28px;color:#78716c;font-size:12px;border-top:1px solid #e7e5e4">${esc(b.softwareName)} · ${esc(b.supportEmail)}${b.footerText ? ' · ' + esc(b.footerText) : ''}</td></tr>
</table></td></tr></table></body></html>`;
  try {
    await t.sendMail({ from, to, subject, text, html });
    return true;
  } catch (err) {
    logger.warn({ err, subject }, 'email delivery failed');
    return false;
  }
}

export interface NotifyInput {
  restaurantId: number | null;
  type: string;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  userId?: number | null;
  audience?: 'restaurant' | 'platform' | 'user';
  permission?: string; // realtime room by permission
  emailTo?: string[];
}

export async function notify(n: NotifyInput, db: Db = pool) {
  const audience = n.audience ?? (n.userId ? 'user' : n.restaurantId ? 'restaurant' : 'platform');
  const res = await exec(
    'INSERT INTO notifications (restaurant_id, user_id, audience, type, title, body, data) VALUES (?,?,?,?,?,?,?)',
    [n.restaurantId, n.userId ?? null, audience, n.type, n.title, n.body ?? null, toJson(n.data ?? {})],
    db,
  );
  const payload = { id: res.insertId, type: n.type, title: n.title, body: n.body, data: n.data };
  if (n.userId) emit(rooms.user(n.userId), 'notification', payload);
  else if (n.restaurantId) emit(n.permission ? rooms.staffPerm(n.restaurantId, n.permission) : rooms.restaurant(n.restaurantId), 'notification', payload);
  else emit(rooms.platform(), 'notification', payload);
  if (n.emailTo?.length) {
    sendEmail(n.emailTo, n.title, n.body || n.title).then((ok) => {
      if (ok) exec('UPDATE notifications SET emailed_at=NOW(3) WHERE id=?', [res.insertId]).catch(() => undefined);
    });
  }
  return res.insertId;
}

export async function restaurantAdminEmails(restaurantId: number): Promise<string[]> {
  const rows = await q<{ email: string }>(
    `SELECT u.email FROM users u JOIN roles r ON r.id=u.role_id WHERE u.restaurant_id=? AND u.active=1 AND r.system_key IN ('owner','admin')`,
    [restaurantId],
  );
  return rows.map((r) => r.email);
}

export async function superAdminEmails(): Promise<string[]> {
  const rows = await q<{ email: string }>('SELECT email FROM users WHERE is_super_admin=1 AND active=1');
  return rows.map((r) => r.email);
}
