import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { intakeOnce, watchIntake } from '../knowledge/intake.mjs';

export async function main(argv = process.argv.slice(2)) {
  const [mode = 'once', ...args] = argv;
  if (!['once', 'watch'].includes(mode)) throw new Error('Usage: node scripts/knowledge-intake.mjs once|watch [--root path] [--inbox path] [--directory path] [--interval-ms 3000]');
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!['--root', '--inbox', '--directory', '--interval-ms'].includes(key) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Invalid intake option');
    options[key.slice(2)] = args[++index];
  }
  const intakeOptions = { workspaceRoot: options.root ?? '.', inbox: options.inbox, directory: options.directory };
  const print = result => process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (mode === 'once') { const result = await intakeOnce(intakeOptions); print(result); if (result.errors) process.exitCode = 1; return result; }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    await watchIntake(intakeOptions, { signal: controller.signal, intervalMs: Number(options['interval-ms'] ?? 3000),
      onResult: result => { if (result.imported || result.errors) print(result); } });
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { process.stderr.write('Knowledge intake failed. Check paths, write locks, and input format; no source text is logged.\n'); process.exitCode = 1; });
}
