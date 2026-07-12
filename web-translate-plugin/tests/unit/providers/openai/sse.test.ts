import { describe, expect, it, vi } from 'vitest';

import {
  readChatCompletionSse,
  SseResponseError,
} from '../../../../src/providers/openai/sse';

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

describe('OpenAI Chat Completions SSE 解析器', () => {
  it('跨 chunk 解析 SSE 并在每个有效事件上报告活动', async () => {
    const response = streamResponse([
      'data: {"choices":[{"delta":{"content":"{\\"translations\\":"}}]}\n',
      '\ndata: {"choices":[{"delta":{"content":"[]}"}}]}\n\ndata: [DONE]\n\n',
    ]);
    const onActivity = vi.fn();
    const onDelta = vi.fn();

    await expect(readChatCompletionSse(response, onActivity, onDelta)).resolves.toBe(
      '{"translations":[]}',
    );
    expect(onActivity).toHaveBeenCalledTimes(2);
    expect(onDelta.mock.calls).toEqual([["{\"translations\":"], ['[]}']]);
  });

  it('允许没有文本的合法元数据事件，但最终必须存在文本', async () => {
    const onActivity = vi.fn();
    const response = streamResponse([
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"OK"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);

    await expect(readChatCompletionSse(response, onActivity)).resolves.toBe('OK');
    expect(onActivity).toHaveBeenCalledTimes(2);
  });

  it('允许百炼在有效文本后发送空 choices 尾事件', async () => {
    const onActivity = vi.fn();
    const response = streamResponse([
      'data: {"choices":[{"delta":{"content":"OK"}}]}\n\n',
      'data: {"choices":[],"usage":{"total_tokens":10}}\n\n',
      'data: [DONE]\n\n',
    ]);

    await expect(readChatCompletionSse(response, onActivity)).resolves.toBe('OK');
    expect(onActivity).toHaveBeenCalledTimes(2);
  });

  it('缺少响应体时返回稳定错误', async () => {
    await expect(readChatCompletionSse(new Response(null), vi.fn())).rejects.toEqual(
      new SseResponseError('SSE_BODY_MISSING'),
    );
  });

  it('无效事件 JSON 时返回稳定错误', async () => {
    await expect(
      readChatCompletionSse(streamResponse(['data: nope\n\n']), vi.fn()),
    ).rejects.toEqual(new SseResponseError('SSE_EVENT_INVALID'));
  });

  it('无效事件结构时返回稳定错误', async () => {
    await expect(
      readChatCompletionSse(streamResponse(['data: {"choices":[{}]}\n\n']), vi.fn()),
    ).rejects.toEqual(new SseResponseError('SSE_EVENT_INVALID'));
  });

  it('流结束但没有文本时返回稳定错误', async () => {
    await expect(
      readChatCompletionSse(
        streamResponse([
          'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
        vi.fn(),
      ),
    ).rejects.toEqual(new SseResponseError('SSE_CONTENT_MISSING'));
  });
});
