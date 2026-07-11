import { describe, expect, it, vi } from 'vitest';

import { MineruClient } from '../../../../src/providers/mineru/client';

const settings = {
  token: 'super-secret-token',
  baseUrl: 'https://mineru.net',
  modelVersion: 'vlm' as const,
};

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('MinerU 客户端', () => {
  it('创建 URL 单任务并使用单任务端点轮询', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { task_id: 't1' } }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { state: 'done', full_zip_url: 'https://cdn.test/result.zip' } }));
    const client = new MineruClient(settings, { fetcher, sleep: vi.fn() });

    const task = await client.createUrlTask('https://example.test/a.pdf');
    expect(task).toEqual({ kind: 'single', id: 't1' });
    await expect(client.waitForResult(task)).resolves.toEqual({
      state: 'done',
      fullZipUrl: 'https://cdn.test/result.zip',
    });
    expect(fetcher.mock.calls[1][0]).toBe('https://mineru.net/api/v4/extract/task/t1');
  });

  it('上传原始 bytes 并按 data_id 从批任务结果中选择条目', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { batch_id: 'b1', file_urls: ['https://upload.test/signed'] } }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: {
          extract_result: [
            { data_id: 'other', state: 'done', full_zip_url: 'https://cdn.test/wrong.zip' },
            { data_id: 'data-1', state: 'done', full_zip_url: 'https://cdn.test/right.zip' },
          ],
        },
      }));
    const client = new MineruClient(settings, {
      fetcher,
      sleep: vi.fn(),
      createId: () => 'data-1',
    });
    const bytes = new Uint8Array([1, 2, 3]).buffer;

    const task = await client.createUploadTask('paper.pdf', bytes);
    expect(task).toEqual({ kind: 'batch', id: 'b1', dataId: 'data-1' });
    expect(fetcher.mock.calls[1]).toMatchObject([
      'https://upload.test/signed',
      { method: 'PUT', body: bytes },
    ]);
    await expect(client.waitForResult(task)).resolves.toEqual({
      state: 'done',
      fullZipUrl: 'https://cdn.test/right.zip',
    });
    expect(fetcher.mock.calls[2][0]).toBe('https://mineru.net/api/v4/extract-results/batch/b1');
  });

  it('规范化等待/运行状态、执行无真实等待的指数退避并有限超时', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { state: 'pending' } }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { state: 'converting' } }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { state: 'uploading' } }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new MineruClient(settings, {
      fetcher,
      sleep,
      maxPollAttempts: 3,
      initialPollDelayMs: 1000,
      maxPollDelayMs: 1500,
    });

    await expect(client.waitForResult({ kind: 'single', id: 't1' })).rejects.toMatchObject({
      code: 'MINERU_TIMEOUT',
    });
    expect(sleep.mock.calls).toEqual([[1000], [1500]]);
  });

  it.each([
    [
      'single',
      { kind: 'single', id: 't1' } as const,
      { code: 0, data: { state: 'running' } },
    ],
    [
      'batch',
      { kind: 'batch', id: 'b1', dataId: 'data-1' } as const,
      {
        code: 0,
        data: { extract_result: [{ data_id: 'data-1', state: 'running' }] },
      },
    ],
  ])('规范化 %s 任务的官方 running 并继续轮询', async (_kind, task, running) => {
    const done = task.kind === 'single'
      ? { code: 0, data: { state: 'done', full_zip_url: 'https://cdn.test/result.zip' } }
      : {
          code: 0,
          data: {
            extract_result: [{
              data_id: 'data-1',
              state: 'done',
              full_zip_url: 'https://cdn.test/result.zip',
            }],
          },
        };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse(running))
      .mockResolvedValueOnce(jsonResponse(done));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new MineruClient(settings, {
      fetcher,
      sleep,
      maxPollAttempts: 2,
    });

    await expect(client.waitForResult(task)).resolves.toMatchObject({ state: 'done' });
    expect(sleep).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('退避 sleep 期间 abort 会立即拒绝且不等待注入 sleep 完成', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({ code: 0, data: { state: 'pending' } }),
    );
    let enterSleep!: () => void;
    const sleepStarted = new Promise<void>((resolve) => { enterSleep = resolve; });
    const sleep = vi.fn(() => {
      enterSleep();
      return new Promise<void>(() => undefined);
    });
    const controller = new AbortController();
    const client = new MineruClient(settings, {
      fetcher,
      sleep,
      maxPollAttempts: 2,
    });

    const waiting = client.waitForResult(
      { kind: 'single', id: 't1' },
      controller.signal,
    );
    await sleepStarted;
    controller.abort();

    await expect(waiting).rejects.toHaveProperty('name', 'AbortError');
  });

  it('done 缺少 Zip URL、failed 与 HTTP 错误都只暴露结构化错误', async () => {
    for (const response of [
      jsonResponse({ code: 0, data: { state: 'done', full_zip_url: '' } }),
      jsonResponse({ code: 0, data: { state: 'failed', err_msg: 'contains super-secret-token and raw body' } }),
      new Response('raw super-secret-token', { status: 500 }),
    ]) {
      const client = new MineruClient(settings, { fetcher: vi.fn().mockResolvedValue(response), sleep: vi.fn() });
      try {
        const result = await client.waitForResult({ kind: 'single', id: 't1' });
        expect(result.state).toBe('failed');
        if (result.state === 'failed') expect(result.error).toBeTruthy();
        expect(JSON.stringify(result)).not.toContain('super-secret-token');
        expect(JSON.stringify(result)).not.toContain('raw body');
      } catch (error) {
        expect(error).toMatchObject({ name: 'MineruError' });
        expect(String(error)).not.toContain('super-secret-token');
      }
    }
  });

  it('支持 AbortSignal，并以无绑定形式调用 fetch', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn();
    const client = new MineruClient(settings, { fetcher, sleep: vi.fn() });
    await expect(client.waitForResult({ kind: 'single', id: 't1' }, controller.signal)).rejects.toHaveProperty('name', 'AbortError');
    expect(fetcher).not.toHaveBeenCalled();

    const guarded = function (this: unknown) {
      expect(this).toBeUndefined();
      return Promise.resolve(jsonResponse({ code: 0, data: { task_id: 't1' } }));
    };
    await new MineruClient(settings, { fetcher: guarded as typeof fetch }).createUrlTask('https://example.test/a.pdf');
  });
});
