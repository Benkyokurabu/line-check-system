export const BUSINESS_NOTION_BOT_ID = '3a5f0120-80a7-8103-a9ae-002788d6919f';

/** @param {{ request: (path: string) => Promise<{ id?: string, name?: string, type?: string, bot?: { workspace_name?: string } }>, tokenSource: string, dataSources?: Array<{ label: string, id: string }> }} options */
export async function notionConnectionStatus({ request, tokenSource, dataSources = [] }) {
  const me = await request('/users/me');
  const sources = [];
  for (const { label, id } of dataSources) {
    try {
      await request(`/data_sources/${id}`);
      sources.push({ label, id, readable: true });
    } catch {
      sources.push({ label, id, readable: false });
    }
  }
  return {
    integration: { name: typeof me.name === 'string' ? me.name : '', botId: me.id },
    workspace: typeof me.bot?.workspace_name === 'string' ? me.bot.workspace_name : '',
    tokenSource,
    usesBusinessConnection: me.type === 'bot' && me.id === BUSINESS_NOTION_BOT_ID,
    dataSources: sources,
  };
}
