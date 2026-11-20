import 'dotenv/config';
import mysql from 'mysql2/promise';

/** Creates a fresh, isolated test database, then runs migrations + base seed. Requires a DB user allowed to CREATE/DROP DATABASE. */
export default async function setup() {
  const name = process.env.TEST_DB_NAME || 'umema_test';
  if (!/^[a-z0-9_]+_test$/.test(name)) throw new Error('Refusing to run tests against a database whose name does not end with _test');
  process.env.DB_NAME = name;
  process.env.NODE_ENV = 'test';
  const conn = await mysql.createConnection({ host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD });
  await conn.query(`DROP DATABASE IF EXISTS \`${name}\``);
  await conn.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.end();
  const { migrate } = await import('../src/cli/migrate.js');
  await migrate(() => undefined);
  const { seed } = await import('../src/cli/seed.js');
  await seed({}, () => undefined);
  const { pool } = await import('../src/lib/db.js');
  await pool.end();
}
