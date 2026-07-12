import { describe, expect, it } from 'vitest';

import { parseTranslationResponse } from '../../../../src/providers/openai/translation-response';

describe('翻译响应解析', () => {
  it.each([
    '{"translations":[{"id":"b1","text":"你好"}]}',
    '```json\n{"translations":[{"id":"b1","text":"你好"}]}\n```',
  ])('解析直接 JSON 和单层 json 围栏', (content) => {
    expect(parseTranslationResponse(content, ['b1'])).toEqual([
      { id: 'b1', text: '你好' },
    ]);
  });

  it.each([
    ['not json', 'TRANSLATION_JSON_INVALID'],
    ['这里是结果：{"translations":[{"id":"b1","text":"你好"}]}', 'TRANSLATION_JSON_INVALID'],
    ['{"answer":"你好"}', 'TRANSLATION_SCHEMA_INVALID'],
    ['{"translations":[{"id":"other","text":"你好"}]}', 'TRANSLATION_ID_UNKNOWN'],
    ['{"translations":[{"id":"b1","text":"一"},{"id":"b1","text":"二"}]}', 'TRANSLATION_ID_DUPLICATE'],
    ['{"translations":[]}', 'TRANSLATION_ID_MISSING'],
  ])('对不兼容内容返回稳定错误码：%s', (content, code) => {
    let thrown: unknown;
    try {
      parseTranslationResponse(content, ['b1']);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code });
    expect(String(thrown)).not.toContain(content);
  });

  it('按请求 ID 顺序返回结果', () => {
    expect(parseTranslationResponse(
      '{"translations":[{"id":"b2","text":"二"},{"id":"b1","text":"一"}]}',
      ['b1', 'b2'],
    )).toEqual([
      { id: 'b1', text: '一' },
      { id: 'b2', text: '二' },
    ]);
  });
});
