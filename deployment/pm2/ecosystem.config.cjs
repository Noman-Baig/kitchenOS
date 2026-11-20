// PM2 process file: API (realtime included), background worker, and Next.js web server.
// pm2 start deployment/pm2/ecosystem.config.cjs && pm2 save && pm2 startup
const path = require('path');
const root = path.resolve(__dirname, '..', '..');

module.exports = {
  apps: [
    {
      name: 'umema-api',
      cwd: path.join(root, 'backend'),
      script: 'dist/server.js',
      node_args: '--enable-source-maps',
      instances: 1, // >1 requires REDIS_URL and sticky sessions (nginx ip_hash)
      exec_mode: 'fork',
      env: { NODE_ENV: 'production', RUN_WORKER_IN_API: 'false' },
      max_memory_restart: '700M',
      kill_timeout: 10000,
    },
    {
      name: 'umema-worker',
      cwd: path.join(root, 'backend'),
      script: 'dist/worker.js',
      instances: 1, // jobs are lock-protected, extra instances are safe but unnecessary
      env: { NODE_ENV: 'production' },
      max_memory_restart: '500M',
    },
    {
      name: 'umema-web',
      cwd: path.join(root, 'frontend'),
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      env: { NODE_ENV: 'production', BACKEND_URL: 'http://192.168.100.198:4000' },
      max_memory_restart: '700M',
    },
  ],
};
