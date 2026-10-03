import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { HOKUSHIN_CATALOG_PATH, validateHokushinCatalog } from '../src/lib/hokushin-school-library.mjs';

const argument = name => process.argv[process.argv.indexOf(name) + 1];
if (!process.argv.includes('--env') || !process.argv.includes('--catalog')) throw Error('--env and --catalog are required');
process.loadEnvFile(argument('--env'));
const file = path.resolve(argument('--catalog'));
const raw = await fs.readFile(file);
const catalog = validateHokushinCatalog(JSON.parse(raw.toString('utf8')));
// Validate every local artifact before modifying the private library.
for (const item of catalog.items) {
  const pdf = await fs.readFile(path.join(path.dirname(file), 'pdf', `${item.id}.pdf`));
  if (pdf.length !== item.bytes || crypto.createHash('sha256').update(pdf).digest('hex') !== item.id || pdf.subarray(0, 5).toString() !== '%PDF-')
    throw Error(`Invalid PDF: ${item.school}`);
}
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const bucketName = 'interview-material-bundles';
const { data: bucket, error: bucketError } = await db.storage.getBucket(bucketName);
if (bucketError || !bucket || bucket.public) throw Error('A private material storage bucket is required');
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({ count: catalog.items.length, bytes: catalog.items.reduce((sum, item) => sum + item.bytes, 0), private: true, applied: false }));
} else {
const storage = db.storage.from(bucketName);
const { data: previous } = await storage.download(HOKUSHIN_CATALOG_PATH);
const previousIds = new Set(previous ? validateHokushinCatalog(JSON.parse(await previous.text())).items.map(item => item.id) : []);
let next = 0, completed = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < catalog.items.length) {
    const item = catalog.items[next++];
    const existing = previousIds.has(item.id) ? await storage.info(item.storagePath) : null;
    if (!existing?.data || existing.error) {
      const pdf = await fs.readFile(path.join(path.dirname(file), 'pdf', `${item.id}.pdf`));
      for (let attempt = 0; ; attempt++) {
        const { error } = await storage.upload(item.storagePath, pdf, { contentType: 'application/pdf', upsert: true });
        if (!error) break;
        if (attempt >= 2) throw Error(`School PDF upload failed: ${item.school}`);
      }
    }
    completed++;
    if (completed % 50 === 0) console.log(JSON.stringify({ uploaded: completed, total: catalog.items.length }));
  }
}));
// Publish the manifest last. Existing viewers continue using immutable PDFs.
const { error: manifestError } = await storage.upload(HOKUSHIN_CATALOG_PATH, raw, { contentType: 'application/json', upsert: true });
if (manifestError) throw Error('Catalog upload failed');
const { data: verified, error: verifyError } = await storage.download(HOKUSHIN_CATALOG_PATH);
if (verifyError || !verified || (await verified.text()) !== raw.toString('utf8')) throw Error('Catalog verification failed');
console.log(JSON.stringify({ applied: true, verified: true, count: catalog.items.length, private: true }));
}
