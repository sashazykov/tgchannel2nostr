import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../src/nostr.js', () => ({
  generateNip01Event: vi.fn(async (content, publicKey, privateKey) => {
    return JSON.stringify({ id: 'test', content, publicKey, privateKey });
  }),
  sendEvent: vi.fn(async () => 'ok'),
}));

import worker from '../src/index.js';
import * as nostr from '../src/nostr.js';

const originalFetch = globalThis.fetch;

function createExecutionContext() {
  const tasks = [];
  return {
    tasks,
    waitUntil(promise) {
      tasks.push(promise);
    },
  };
}

function setFetchMock(impl) {
  const mock = vi.fn(impl);
  globalThis.fetch = mock;
  return mock;
}

afterEach(() => {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
  } else {
    delete globalThis.fetch;
  }
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('worker fetch', () => {
  it('rejects file proxy without bot token', async () => {
    const ctx = createExecutionContext();
    const resp = await worker.fetch(
      new Request('https://example.com/tg/file/photos/file.jpg', { method: 'GET' }),
      {},
      ctx
    );
    expect(resp.status).toBe(500);
    expect(await resp.text()).toBe('Missing telegramBotToken');
  });

  it('proxies telegram files with cache headers', async () => {
    const fetchMock = setFetchMock(async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      expect(url).toBe('https://api.telegram.org/file/bottoken123/photos/file.jpg');
      return new Response('image-body', {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      });
    });

    const ctx = createExecutionContext();
    const resp = await worker.fetch(
      new Request('https://example.com/tg/file/photos/file.jpg', { method: 'GET' }),
      { telegramBotToken: 'token123' },
      ctx
    );

    expect(resp.status).toBe(200);
    expect(resp.headers.get('Cache-Control')).toBe('public, max-age=86400');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends text and photo url to nostr', async () => {
    setFetchMock(async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.startsWith('https://api.telegram.org/bot')) {
        return new Response(
          JSON.stringify({ ok: true, result: { file_path: 'photos/2.jpg' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const ctx = createExecutionContext();
    const env = {
      telegramBotToken: 'token123',
      publicKey: 'pub',
      privateKey: 'priv',
    };
    const payload = {
      channel_post: {
        caption: 'hello',
        photo: [{ file_id: '1' }, { file_id: '2' }],
      },
    };
    const resp = await worker.fetch(
      new Request('https://example.com/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      env,
      ctx
    );

    expect(await resp.text()).toBe('OK');
    await Promise.all(ctx.tasks);
    expect(nostr.generateNip01Event).toHaveBeenCalledWith(
      'hello\n\nhttps://example.com/tg/file/photos/2.jpg',
      'pub',
      'priv'
    );
  });

  it('flushes media groups after the delay', async () => {
    vi.useFakeTimers();
    setFetchMock(async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.startsWith('https://api.telegram.org/bot')) {
        const fileId = new URL(url).searchParams.get('file_id');
        return new Response(
          JSON.stringify({ ok: true, result: { file_path: `photos/${fileId}.jpg` } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const ctx = createExecutionContext();
    const env = {
      telegramBotToken: 'token123',
      publicKey: 'pub',
      privateKey: 'priv',
    };

    await worker.fetch(
      new Request('https://example.com/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_post: {
            media_group_id: 'group-1',
            caption: 'first',
            photo: [{ file_id: '1' }],
          },
        }),
      }),
      env,
      ctx
    );

    await worker.fetch(
      new Request('https://example.com/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_post: {
            media_group_id: 'group-1',
            photo: [{ file_id: '2' }],
          },
        }),
      }),
      env,
      ctx
    );

    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all(ctx.tasks);

    expect(nostr.generateNip01Event).toHaveBeenCalledTimes(1);
    const content = nostr.generateNip01Event.mock.calls[0][0];
    expect(content).toContain('first');
    expect(content).toContain('https://example.com/tg/file/photos/1.jpg');
    expect(content).toContain('https://example.com/tg/file/photos/2.jpg');
  });
});
