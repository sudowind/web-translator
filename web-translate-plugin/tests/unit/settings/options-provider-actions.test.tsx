import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import App, {
  providerErrorField,
} from '../../../entrypoints/options/App';

describe('设置页 Provider 操作', () => {
  it('分别呈现 LLM 测试和无额度 MinerU 检查', () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('测试 LLM');
    expect(html).toContain('检查 MinerU 配置');
    expect(html).toContain('尚未创建解析任务');
    expect(html).not.toContain('>测试连接<');
  });

  it('明确区分两个 Provider 的字段与状态区域', () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('LLM 接口地址');
    expect(html).toContain('LLM API Key');
    expect(html).toContain('MinerU 接口地址');
    expect(html.match(/aria-live="polite"/g)).toHaveLength(3);
  });

  it('保存和独立操作都把错误定位到对应 Provider 字段', () => {
    expect(providerErrorField('API Key 不能为空', 'save')).toBe('apiKey');
    expect(providerErrorField('LLM 请求失败（HTTP 404）', 'llm')).toBe(
      'baseUrl',
    );
    expect(
      providerErrorField('MinerU Token 不能为空', 'mineru'),
    ).toBe('mineruToken');
  });
});
