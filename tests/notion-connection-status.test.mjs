import assert from 'node:assert/strict';
import test from 'node:test';
import { BUSINESS_NOTION_BOT_ID, notionConnectionStatus } from '../src/lib/notion-connection-status.mjs';

test('reports the live integration and never returns credentials or page contents', async () => {
  const result = await notionConnectionStatus({
    tokenSource: 'NOTION_TOKEN',
    dataSources: [{ label: '生徒情報', id: 'source' }],
    request: async path => path === '/users/me'
      ? { type: 'bot', id: BUSINESS_NOTION_BOT_ID, name: '塾業務システム連携', bot: { workspace_name: '勉強クラブ', token: 'private-secret' } }
      : { properties: { secret: 'private-content' } },
  });
  assert.equal(result.usesBusinessConnection, true);
  assert.equal(result.dataSources[0].readable, true);
  assert.doesNotMatch(JSON.stringify(result), /private-secret|private-content/);
});

test('distinguishes an old bot and an unreadable source without leaking API errors', async () => {
  const result = await notionConnectionStatus({
    tokenSource: 'NOTION_API_KEY', dataSources: [{ label: '生徒情報', id: 'source' }],
    request: async path => { if (path === '/users/me') return { type: 'bot', id: 'old-bot', name: 'Codex 読み取り用' }; throw Error('secret-token'); },
  });
  assert.equal(result.usesBusinessConnection, false);
  assert.equal(result.dataSources[0].readable, false);
  assert.doesNotMatch(JSON.stringify(result), /secret-token/);
});

test('does not claim a connection succeeded when bot lookup fails', async () => {
  await assert.rejects(notionConnectionStatus({ request: async () => { throw Error('unavailable'); }, tokenSource: 'NOTION_TOKEN' }));
});
