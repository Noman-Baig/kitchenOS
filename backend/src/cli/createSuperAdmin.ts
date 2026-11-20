import readline from 'node:readline';
import { exec, one, pool } from '../lib/db.js';
import { hashPassword, zPassword } from '../routes/auth.js';

/**
 * Creates the first Super Admin from the server console (never via a public endpoint).
 * Usage: npm run create-super-admin -- --email admin@yourdomain.com --name "Platform Admin"
 * The password is read from SUPER_ADMIN_PASSWORD or prompted (input hidden).
 */
function arg(name: string) { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; }

async function promptHidden(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const anyRl = rl as any;
  anyRl._writeToOutput = (s: string) => { if (s.includes(question)) anyRl.output.write(s); else anyRl.output.write('*'); };
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); }));
}

async function main() {
  const email = (arg('email') || '').toLowerCase();
  const name = arg('name') || 'Platform Administrator';
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Provide --email');
  const password = process.env.SUPER_ADMIN_PASSWORD || await promptHidden('Password (min 10 chars, letters and numbers): ');
  const v = zPassword.safeParse(password);
  if (!v.success) throw new Error(v.error.issues[0].message);
  const existing = await one<any>('SELECT id, is_super_admin FROM users WHERE email=?', [email]);
  if (existing && !existing.is_super_admin) throw new Error('That email belongs to a restaurant account');
  if (existing) {
    await exec('UPDATE users SET password_hash=?, active=1, failed_logins=0, locked_until=NULL WHERE id=?', [await hashPassword(password), existing.id]);
    await exec('UPDATE auth_sessions SET revoked_at=NOW(3) WHERE user_id=?', [existing.id]);
    console.log(`Super Admin ${email} password reset.`);
  } else {
    await exec('INSERT INTO users (restaurant_id, is_super_admin, email, password_hash, name) VALUES (NULL, 1, ?, ?, ?)', [email, await hashPassword(password), name]);
    console.log(`Super Admin ${email} created.`);
  }
  await exec("INSERT INTO audit_logs (actor_type, action, entity, entity_id) VALUES ('system', 'super_admin.cli', 'user', ?)", [email]);
}
main().then(async () => { await pool.end(); process.exit(0); }).catch(async (e) => { console.error(e.message); await pool.end(); process.exit(1); });
