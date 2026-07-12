import { readFile } from 'node:fs/promises';

import type { MineruSettings } from '../../src/providers/mineru/contracts';
import {
  inferProviderDialect,
  type OpenAiSettings,
} from '../../src/settings/schema';

export interface LivePipelineConfig {
  mineru: MineruSettings;
  openAi: OpenAiSettings;
  sourceLanguage: 'en';
  targetLanguage: 'zh-CN';
}

export function parseLiveConfig(
  mineruValue: unknown,
  llmValue: unknown,
): LivePipelineConfig {
  const mineru = readMineru(mineruValue);
  const llm = readLlm(llmValue);
  return {
    mineru,
    openAi: {
      apiKey: llm.apiKey,
      baseUrl: llm.baseUrl,
      dialect: inferProviderDialect(llm.baseUrl),
      defaultModel: llm.model,
      translation: {
        reasoning: { mode: 'off' },
        timeoutMs: llm.timeoutMs,
      },
      agent: {
        inheritDefaultModel: true,
        profile: {
          model: llm.model,
          reasoning: { mode: 'auto' },
          timeoutMs: 120_000,
        },
      },
    },
    sourceLanguage: 'en',
    targetLanguage: 'zh-CN',
  };
}

export async function loadLiveConfig(): Promise<LivePipelineConfig> {
  const mineru = await readJson(
    new URL('../../.mineru-experiment.local.json', import.meta.url),
    '.mineru-experiment.local.json',
  );
  const llm = await readJson(
    new URL('../../.llm-experiment.local.json', import.meta.url),
    '.llm-experiment.local.json',
  );
  return parseLiveConfig(mineru, llm);
}

function readMineru(value: unknown): MineruSettings {
  const record = requireRecord(value, 'MinerU 配置');
  const baseUrl = requireHttpsRoot(record.baseUrl, 'MinerU API 根地址');
  const token = requireString(record.token, 'MinerU Token');
  const modelVersion = record.modelVersion;
  if (modelVersion !== 'vlm' && modelVersion !== 'pipeline') {
    throw new Error('MinerU 模型版本无效');
  }
  return { baseUrl, token, modelVersion };
}

function readLlm(value: unknown): {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
} {
  const record = requireRecord(value, 'LLM 配置');
  const baseUrl = requireHttpsUrl(record.baseUrl, 'LLM API 根地址');
  const apiKey = requireString(record.apiKey, 'LLM API Key');
  const model = requireString(record.model, 'LLM 模型');
  const timeoutMs = record.timeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || (timeoutMs as number) < 5_000 || (timeoutMs as number) > 300_000) {
    throw new Error('LLM 超时无效');
  }
  return { baseUrl, apiKey, model, timeoutMs: timeoutMs as number };
}

async function readJson(url: URL, label: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(url, 'utf8'));
  } catch {
    throw new Error(`无法读取 ${label}`);
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label}无效`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}无效`);
  return value.trim();
}

function requireHttpsRoot(value: unknown, label: string): string {
  const normalized = requireHttpsUrl(value, label);
  const url = new URL(normalized);
  if (url.pathname !== '/' || url.search || url.hash) throw new Error(`${label}无效`);
  return url.origin;
}

function requireHttpsUrl(value: unknown, label: string): string {
  const raw = requireString(value, label);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label}无效`);
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(`${label}无效`);
  }
  return raw.replace(/\/+$/, '');
}
