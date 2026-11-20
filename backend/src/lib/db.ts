import mysql, { type Pool, type PoolConnection, type ResultSetHeader } from 'mysql2/promise';
import { config } from '../config.js';

export type Db = Pool | PoolConnection;

export const pool: Pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  socketPath: config.db.socketPath,
  connectionLimit: config.db.connectionLimit,
  waitForConnections: true,
  timezone: 'Z',
  dateStrings: false,
  decimalNumbers: false, // DECIMAL columns come back as strings: never lose precision
  supportBigNumbers: true,
  bigNumberStrings: false,
  charset: 'utf8mb4',
  connectTimeout: 10000,
  enableKeepAlive: true,
});

pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+00:00'");
});

/** Run a SELECT and return typed rows. Values are escaped by mysql2 (no string concatenation of input). */
export async function q<T = any>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T[]> {
  const [rows] = await db.query(sql, params);
  return rows as T[];
}

export async function one<T = any>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T | null> {
  const rows = await q<T>(sql, params, db);
  return rows[0] ?? null;
}

export async function exec(sql: string, params: unknown[] = [], db: Db = pool): Promise<ResultSetHeader> {
  const [res] = await db.query(sql, params);
  return res as ResultSetHeader;
}

/** Execute fn inside a transaction. Rolls back on error. Retries once on deadlock. */
export async function tx<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err: any) {
      try { await conn.rollback(); } catch { /* ignore */ }
      if (attempt < 2 && (err?.code === 'ER_LOCK_DEADLOCK' || err?.errno === 1213)) continue;
      throw err;
    } finally {
      conn.release();
    }
  }
}

/** JSON columns: MySQL returns objects, MariaDB returns strings. Normalise. */
export function j<T = any>(v: unknown, fallback: T): T {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T; } catch { return fallback; }
  }
  return v as T;
}

export function toJson(v: unknown) {
  return v === undefined ? null : JSON.stringify(v);
}

export const now = () => new Date();
