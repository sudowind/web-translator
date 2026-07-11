import { describe, expect, it } from 'vitest';

import { classifyPdfTarget } from '../../../src/pdf-takeover/detect-pdf';

describe('classifyPdfTarget', () => {
  it.each([
    ['https://arxiv.org/pdf/2401.00001', 'application/pdf', 'arxiv'],
    ['https://example.com/paper.pdf?download=1#page=2', 'application/pdf', 'remote'],
    ['file:///C:/papers/test.pdf', 'application/pdf', 'local'],
  ] as const)('识别 %s', (url, contentType, expected) => {
    expect(classifyPdfTarget({ url, contentType })).toBe(expected);
  });

  it('拒绝普通网页', () => {
    expect(classifyPdfTarget({ url: 'https://example.com', contentType: 'text/html' })).toBeNull();
  });

  it('非法 URL 返回 null', () => {
    expect(classifyPdfTarget({ url: 'not a url', contentType: 'application/pdf' })).toBeNull();
  });
});
