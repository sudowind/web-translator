import { describe, expect, it } from 'vitest';

import {
  isTranslationBlocksMessage,
  type TranslationBlocksMessage,
} from '../../../src/webpage/messages';

function validMessage(): TranslationBlocksMessage {
  return {
    type: 'translation:blocks',
    sessionId: 'session-1',
    blocks: [{ id: 'block-1', text: 'Hello world' }],
  };
}

describe('isTranslationBlocksMessage', () => {
  it('只接受结构化文本块请求', () => {
    expect(isTranslationBlocksMessage(validMessage())).toBe(true);
  });

  it('拒绝空批次、超大批次、重复 id 与超长字段', () => {
    expect(isTranslationBlocksMessage({ ...validMessage(), blocks: [] })).toBe(false);
    expect(
      isTranslationBlocksMessage({
        ...validMessage(),
        blocks: Array.from({ length: 21 }, (_, index) => ({
          id: `block-${index}`,
          text: 'Hello',
        })),
      }),
    ).toBe(false);
    expect(
      isTranslationBlocksMessage({
        ...validMessage(),
        blocks: [
          { id: 'same', text: 'First' },
          { id: 'same', text: 'Second' },
        ],
      }),
    ).toBe(false);
    expect(
      isTranslationBlocksMessage({ ...validMessage(), sessionId: 's'.repeat(129) }),
    ).toBe(false);
    expect(
      isTranslationBlocksMessage({
        ...validMessage(),
        blocks: [{ id: 'block-1', text: 'x'.repeat(10_001) }],
      }),
    ).toBe(false);
  });

  it('拒绝夹带 Provider 凭据或错误字段类型', () => {
    expect(
      isTranslationBlocksMessage({ ...validMessage(), apiKey: 'secret' }),
    ).toBe(false);
    expect(
      isTranslationBlocksMessage({
        ...validMessage(),
        blocks: [{ id: 'block-1', text: 42 }],
      }),
    ).toBe(false);
  });
});
