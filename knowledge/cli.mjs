import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildContext, historyKnowledge, saveKnowledge, searchKnowledge } from './context-store.mjs';

export async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  const options = { sourceRoots: [] };
  const allowed = new Set(['root', 'directory', 'query', 'at', 'limit', 'campus', 'grade', 'role', 'subject', 'file', 'expected-revision', 'id', 'source-root']);
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, '');
    if (key === 'history' && args[i] === '--history') { options.history = true; continue; }
    if (!args[i].startsWith('--') || !allowed.has(key) || args[i + 1] === undefined || args[i + 1].startsWith('--')) throw new Error(`Invalid option: ${args[i]}`);
    if (key === 'source-root') options.sourceRoots.push(args[++i]);
    else options[key] = args[++i];
  }
  const workspaceRoot = path.resolve(options.root ?? '.');
  const directory = path.resolve(workspaceRoot, options.directory ?? '資料集約/知識基盤');
  if (command === 'save') {
    if (!options.file || options['expected-revision'] === undefined) throw new Error('save requires --file and --expected-revision');
    const record = JSON.parse((await readFile(path.resolve(workspaceRoot, options.file), 'utf8')).replace(/^\uFEFF/, ''));
    return saveKnowledge({ directory, workspaceRoot, record, expectedRevision: Number(options['expected-revision']), allowedSourceRoots: options.sourceRoots });
  }
  if (command === 'history') {
    if (!options.id) throw new Error('history requires --id');
    return historyKnowledge(directory, options.id);
  }
  if (command === 'search' || command === 'context') {
    const scope = { campuses: options.campus, grades: options.grade, roles: options.role, subject: options.subject };
    const result = await searchKnowledge({ directory, workspaceRoot, allowedSourceRoots: options.sourceRoots,
      query: options.query ?? '', scope, at: options.at, limit: Number(options.limit ?? 10), includeHistory: options.history ?? false });
    return command === 'context' ? buildContext(result) : result;
  }
  throw new Error('Usage: node knowledge/cli.mjs search|context|history|save [--query text] [--root path] [--file record.json --expected-revision 0]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n')).catch(error => {
    process.stderr.write(error.message + '\n'); process.exitCode = 1;
  });
}
