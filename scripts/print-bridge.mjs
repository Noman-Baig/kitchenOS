#!/usr/bin/env node
/**
 * Local print bridge for network (LAN) ESC/POS printers.
 *
 * Browsers cannot open raw TCP sockets, so POS screens POST the ESC/POS bytes to this tiny HTTP server
 * running on a computer in the restaurant, which forwards them to the printer on TCP port 9100.
 *
 *   node scripts/print-bridge.mjs            # listens on 127.0.0.1:9123
 *   PRINT_BRIDGE_PORT=9200 node scripts/print-bridge.mjs
 *   PRINT_BRIDGE_ORIGINS=https://pos.example.com node scripts/print-bridge.mjs
 *
 * Safety: listens only on localhost, forwards only to private-network (RFC1918 / link-local) addresses,
 * caps payload size, and only accepts requests from allowed web origins (CORS).
 */
import http from 'node:http';
import net from 'node:net';

const PORT = Number(process.env.PRINT_BRIDGE_PORT || 9123);
const ORIGINS = (process.env.PRINT_BRIDGE_ORIGINS || '*').split(',').map((s) => s.trim());
const MAX = 512 * 1024;

const isPrivate = (ip) => {
  if (!net.isIPv4(ip)) return false;
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
};

function cors(req, res) {
  const origin = req.headers.origin || '';
  const ok = ORIGINS.includes('*') || ORIGINS.includes(origin);
  if (ok && origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  return ok;
}

http.createServer((req, res) => {
  const allowed = cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  const url = new URL(req.url || '/', 'http://192.168.100.198');
  if (req.method === 'GET' && url.pathname === '/health') { res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}'); return; }
  if (!allowed) { res.writeHead(403).end('origin not allowed'); return; }
  if (req.method !== 'POST' || url.pathname !== '/print') { res.writeHead(404).end(); return; }
  const host = url.searchParams.get('host') || '';
  const port = Number(url.searchParams.get('port') || 9100);
  if (!isPrivate(host) || !Number.isInteger(port) || port < 1 || port > 65535) { res.writeHead(400).end('host must be a private IPv4 address'); return; }
  const chunks = []; let size = 0;
  req.on('data', (c) => { size += c.length; if (size > MAX) { res.writeHead(413).end('too large'); req.destroy(); } else chunks.push(c); });
  req.on('end', () => {
    if (res.writableEnded) return;
    const sock = net.createConnection({ host, port, timeout: 5000 }, () => { sock.end(Buffer.concat(chunks)); });
    sock.on('close', (hadErr) => { if (!res.writableEnded) res.writeHead(hadErr ? 502 : 200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: !hadErr })); });
    sock.on('timeout', () => { sock.destroy(); if (!res.writableEnded) res.writeHead(504).end('printer timeout'); });
    sock.on('error', (e) => { if (!res.writableEnded) res.writeHead(502).end(`printer error: ${e.message}`); });
  });
}).listen(PORT, 'localhost', () => console.log(`print bridge listening on http://192.168.100.198:${PORT}`));
