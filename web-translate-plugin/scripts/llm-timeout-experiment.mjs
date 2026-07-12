import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const configUrl = new URL('../.llm-experiment.local.json', import.meta.url);

async function main() {
  const config = await loadConfig();
  const cli = readCliOptions(process.argv.slice(2));
  const blockCount = cli.blockCount ?? config.blockCount;
  const timeoutMs = cli.timeoutMs ?? config.timeoutMs;
  const messages = createMessages(blockCount);
  const allCases = [
    { name: '非流式 + JSON Object', stream: false, responseFormat: true },
    { name: '流式 + JSON Object', stream: true, responseFormat: true },
    { name: '非流式 + 仅提示词约束 JSON', stream: false, responseFormat: false },
  ];
  const cases = cli.only === undefined ? allCases : allCases.filter((item) => item.stream === (cli.only === 'stream'));
  const runConfig = { ...config, timeoutMs };

  console.log(`模型: ${config.model}`);
  console.log(`输入: ${blockCount} blocks / ${messages[1].content.length} chars`);
  console.log(`单次总超时: ${timeoutMs} ms`);
  console.log('实验不会打印 API Key、完整请求或模型输出。\n');

  const results = [];
  for (const experiment of cases) {
    process.stdout.write(`${experiment.name} ... `);
    const result = await runCase(runConfig, messages, experiment);
    results.push(result);
    console.log(formatOneLine(result));
  }

  console.log('\n汇总');
  console.table(results.map(({ name, status, headersMs, firstTextMs, maxChunkGapMs, totalMs, outputChars, jsonValid, schemaValid, error }) => ({
    case: name,
    status,
    headersMs,
    firstTextMs,
    maxChunkGapMs,
    totalMs,
    outputChars,
    jsonValid,
    schemaValid,
    error,
  })));
}

async function loadConfig() {
  let value;
  try {
    value = JSON.parse(await readFile(configUrl, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('缺少 .llm-experiment.local.json；请复制示例文件并填写本地凭据。');
    }
    throw new Error(`无法读取实验配置：${safeError(error)}`);
  }

  const baseUrl = requireString(value.baseUrl, 'baseUrl').replace(/\/+$/, '');
  const apiKey = requireString(value.apiKey, 'apiKey');
  const model = requireString(value.model, 'model');
  const timeoutMs = optionalInteger(value.timeoutMs, 120_000, 5_000, 300_000, 'timeoutMs');
  const blockCount = optionalInteger(value.blockCount, 12, 1, 40, 'blockCount');
  return { baseUrl, apiKey, model, timeoutMs, blockCount };
}

function createMessages(blockCount) {
  const paragraph =
    'Large language models are increasingly used to assist scientific reading. ' +
    'A reliable translation system must preserve terminology, equations, references, and the logical relationship between neighboring sentences. ' +
    'Latency is also important because readers expect each page to become available without waiting for the whole paper. ' +
    'This paragraph is synthetic and contains no private document content.';
  const blocks = Array.from({ length: blockCount }, (_, index) => ({
    id: `experiment-block-${index + 1}`,
    text: `${paragraph} ${paragraph}`,
  }));
  return [
    {
      role: 'system',
      content:
        'Translate each block from English to Simplified Chinese. ' +
        'Return one JSON object with a translations array. Preserve every id exactly once.',
    },
    { role: 'user', content: JSON.stringify({ blocks }) },
  ];
}

async function runCase(config, messages, experiment) {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('TOTAL_TIMEOUT')), config.timeoutMs);
  const body = { model: config.model, messages, stream: experiment.stream, enable_thinking: false };
  if (experiment.responseFormat) body.response_format = { type: 'json_object' };

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const headersMs = elapsed(started);
    if (!response.ok) {
      await response.body?.cancel();
      return result(experiment.name, response.status, headersMs, null, elapsed(started), '', `HTTP_${response.status}`);
    }

    const measured = experiment.stream
      ? await readStream(response, started)
      : await readJsonResponse(response, started);
    return result(
      experiment.name,
      response.status,
      headersMs,
      measured.firstTextMs,
      elapsed(started),
      measured.content,
      '',
      measured.maxChunkGapMs ?? null,
    );
  } catch (error) {
    const code = controller.signal.aborted ? 'TOTAL_TIMEOUT' : safeError(error);
    return result(experiment.name, 'ERR', null, null, elapsed(started), '', code);
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonResponse(response, started) {
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('RESPONSE_CONTENT_INVALID');
  return { content, firstTextMs: elapsed(started) };
}

async function readStream(response, started) {
  if (!response.body) throw new Error('RESPONSE_BODY_MISSING');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let content = '';
  let firstTextMs = null;
  let previousTextAt = null;
  let maxChunkGapMs = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let event;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }
      const delta = event?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        const receivedAt = elapsed(started);
        if (firstTextMs === null) firstTextMs = receivedAt;
        if (previousTextAt !== null) maxChunkGapMs = Math.max(maxChunkGapMs ?? 0, receivedAt - previousTextAt);
        previousTextAt = receivedAt;
        content += delta;
      }
    }
  }
  return { content, firstTextMs, maxChunkGapMs };
}

function result(name, status, headersMs, firstTextMs, totalMs, content, error = '', maxChunkGapMs = null) {
  let parsed;
  let jsonValid = false;
  try {
    parsed = JSON.parse(content);
    jsonValid = true;
  } catch {}
  const schemaValid = Array.isArray(parsed?.translations) || Array.isArray(parsed?.blocks);
  return {
    name,
    status,
    headersMs,
    firstTextMs,
    maxChunkGapMs,
    totalMs,
    outputChars: content.length,
    jsonValid,
    schemaValid,
    error,
  };
}

function readCliOptions(args) {
  const options = {};
  for (const arg of args) {
    if (arg === '--only=stream') options.only = 'stream';
    else if (arg === '--only=non-stream') options.only = 'non-stream';
    else if (arg.startsWith('--block-count=')) options.blockCount = parseCliInteger(arg, '--block-count=', 1, 40);
    else if (arg.startsWith('--timeout-ms=')) options.timeoutMs = parseCliInteger(arg, '--timeout-ms=', 5_000, 300_000);
    else throw new Error(`未知实验参数：${arg}`);
  }
  return options;
}

function parseCliInteger(arg, prefix, min, max) {
  const value = Number(arg.slice(prefix.length));
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${prefix.slice(2, -1)} 必须是 ${min} 到 ${max} 之间的整数。`);
  }
  return value;
}

function formatOneLine(value) {
  if (value.error) return `${value.error} (${value.totalMs} ms)`;
  return `首段 ${value.firstTextMs ?? '-'} ms，总计 ${value.totalMs} ms，${value.outputChars} chars，JSON=${value.jsonValid}`;
}

function elapsed(started) {
  return Math.round(performance.now() - started);
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} 必须是非空字符串。`);
  return value.trim();
}

function optionalInteger(value, fallback, min, max, name) {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < min || selected > max) {
    throw new Error(`${name} 必须是 ${min} 到 ${max} 之间的整数。`);
  }
  return selected;
}

function safeError(error) {
  if (error instanceof Error) return error.message.replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]');
  return 'UNKNOWN_ERROR';
}

main().catch((error) => {
  console.error(safeError(error));
  process.exitCode = 1;
});
