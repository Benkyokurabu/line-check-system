import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

export function loadBenkeiEnvironment(root = process.cwd()) {
  const parent = path.resolve(root, '../..');
  for (const file of [path.join(root, '.env.local'), path.join(parent, '.env.local')]) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return { root, parent };
}

export async function connectBenkeiDatabase() {
  const { root, parent } = loadBenkeiEnvironment();
  if (!process.env.SUPABASE_URL) throw new Error('Database configuration unavailable');
  const project = new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
  const file = [root, parent].map(dir => path.join(dir, 'supabase で設定したパスワード.txt')).find(p => fs.existsSync(p));
  const passwords = process.env.SUPABASE_DB_PASSWORD ? [process.env.SUPABASE_DB_PASSWORD] : file ? fs.readFileSync(file, 'utf8').split(/\r?\n/).map(v => v.trim()).filter(v => v.length >= 12 && v.length <= 64 && !v.includes(':')).reverse() : [];
  for (const host of ['aws-1-ap-northeast-1.pooler.supabase.com', 'aws-0-ap-northeast-1.pooler.supabase.com', `db.${project}.supabase.co`]) {
    for (const password of passwords) {
      const db = new pg.Client({ host, port: host.startsWith('db.') ? 5432 : 6543, user: host.startsWith('db.') ? 'postgres' : `postgres.${project}`, password, database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000, query_timeout: 30000 });
      try { await db.connect(); return db; } catch { await db.end().catch(() => {}); }
    }
  }
  throw new Error('Database connection unavailable');
}
