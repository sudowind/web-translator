import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import App, { availableReasoningModes, dialectForEditedUrl, providerErrorField } from '../../../entrypoints/options/App';

describe('设置页 Provider 操作', () => {
  it('分别呈现三类 LLM 测试和 MinerU 检查', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('测试快速连通');
    expect(html).toContain('测试翻译配置');
    expect(html).toContain('测试智能体配置');
    expect(html).toContain('检查 MinerU 配置');
  });

  it('呈现 Provider 方言、独立模型、思考模式与超时设置', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('阿里云百炼 / DashScope');
    expect(html).toContain('翻译模型');
    expect(html).toContain('论文智能体配置');
    expect(html).toContain('思考模式');
    expect(html).toContain('翻译超时（秒）');
  });

  it('按方言限制可选思考模式', () => {
    expect(availableReasoningModes('dashscope')).toEqual(['off', 'auto', 'on']);
    expect(availableReasoningModes('openai')).toEqual(['off', 'auto', 'on']);
    expect(availableReasoningModes('minimax')).toEqual(['off', 'auto']);
    expect(availableReasoningModes('generic-openai')).toEqual(['off', 'auto']);
  });

  it('自动推断跟随 Endpoint，手动选择后保持用户覆盖', () => {
    expect(dialectForEditedUrl('generic-openai', 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', false)).toBe('dashscope');
    expect(dialectForEditedUrl('dashscope', 'https://api.openai.com/v1', false)).toBe('openai');
    expect(dialectForEditedUrl('generic-openai', 'https://api.openai.com/v1', true)).toBe('generic-openai');
  });

  it('把错误定位到对应 Provider 字段', () => {
    expect(providerErrorField('API Key 不能为空', 'save')).toBe('apiKey');
    expect(providerErrorField('快速连通测试失败（HTTP 404）', 'llm')).toBe('baseUrl');
    expect(providerErrorField('问答模型不能为空', 'save')).toBe('agentModel');
    expect(providerErrorField('MinerU Token 不能为空', 'mineru')).toBe('mineruToken');
  });
});
