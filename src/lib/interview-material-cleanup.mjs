/** Storage listings include virtual lease folders; remove their objects before deleting a job. */
export async function removeMaterialJobFiles(storage, jobId) {
  const paths = [];
  async function collect(folder, depth = 0) {
    if (depth > 4) throw Error('Material storage folder is too deep');
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await storage.list(folder, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
      if (error) throw error;
      for (const file of data || []) {
        if (!file.name || file.name === '.' || file.name === '..' || /[\\/]/u.test(file.name)) throw Error('Invalid material storage name');
        const path = `${folder}/${file.name}`;
        if (file.id === null) await collect(path, depth + 1);
        else paths.push(path);
      }
      if ((data || []).length < 1000) break;
    }
  }
  await collect(`jobs/${jobId}`);
  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await storage.remove(paths.slice(index, index + 100));
    if (error) throw error;
  }
}
