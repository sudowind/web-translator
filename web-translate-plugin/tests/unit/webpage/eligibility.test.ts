// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { isEligiblePage } from '../../../src/webpage/eligibility';

describe('普通网页资格判断', () => {
  it.each([
    'chrome-extension://extension-id/options.html',
    'file:///C:/private.html',
    'ftp://example.com/readme',
    'https://example.com/password/reset',
    'https://example.com/checkout/order',
    'https://example.com/payment/confirm',
    'https://example.com/admin/users',
    'https://example.com/payments/history',
    'https://example.com/billingportal',
    'https://example.com/administration/users',
    'https://example.com/manual.pdf?download=1',
    'https://arxiv.org/pdf/2401.00001#page=2',
  ])('拒绝不适合翻译的地址 %s', (url) => {
    expect(isEligiblePage(new URL(url), document)).toBe(false);
  });

  it('对损坏的 URL 编码安全返回不符合资格', () => {
    expect(
      isEligiblePage(new URL('https://example.com/%E0%A4%A'), document),
    ).toBe(false);
  });

  it('拒绝包含密码输入框的页面并允许普通 HTTP/HTTPS 页面', () => {
    document.body.innerHTML = '<input type="password">';
    expect(isEligiblePage(new URL('https://example.com/login'), document)).toBe(
      false,
    );

    document.body.innerHTML = '<main>Documentation</main>';
    expect(isEligiblePage(new URL('https://example.com/docs'), document)).toBe(
      true,
    );
    expect(isEligiblePage(new URL('http://localhost/article'), document)).toBe(
      true,
    );
  });
});
