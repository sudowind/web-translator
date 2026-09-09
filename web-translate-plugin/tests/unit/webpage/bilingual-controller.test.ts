// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { BilingualController } from '../../../src/webpage/bilingual-controller';
it('首屏优先且批次同时受条数和字符预算限制', () => {
  document.body.innerHTML = Array.from({ length: 25 }, (_, i) => '<p>Page ' + i + ' ' + 'x'.repeat(999) + '</p>').join('');
  const nodes = document.querySelectorAll('p');
  nodes.forEach((p, i) => vi.spyOn(p, 'getBoundingClientRect').mockReturnValue({ top: i === 24 ? 0 : 5000, bottom: i === 24 ? 50 : 5100 } as DOMRect));
  const controller = new BilingualController(document.body, () => {});
  controller.reconcile(); const batch = controller.takeBatch();
  expect(batch[0].block.text).toContain('Page 24');
  expect(batch.length).toBeLessThanOrEqual(20);
  expect(batch.reduce((sum, r) => sum + r.block.text.length, 0)).toBeLessThanOrEqual(12000);
  controller.clear();
});
it('超长语义块明确失败并不阻塞其他段落', () => {
  document.body.innerHTML = '<p>' + 'x'.repeat(10001) + '</p><p>Normal</p>';
  const controller = new BilingualController(document.body, () => {});
  controller.reconcile(); expect(controller.takeBatch().map(r => r.block.text)).toEqual(['Normal']);
  expect(controller.status().failed).toBe(1);
  expect(document.querySelector('[data-web-translate-state="failed"]')?.textContent).toContain('过长');
  controller.clear();
});
it('MDN 类页面可见正文优先于导航，首批最多三块', () => {
  document.body.innerHTML = '<nav><p>Menu</p><p>Account</p></nav><main><h1>Article</h1><p>Introduction</p><p>Content</p><p>More</p></main>';
  const controller = new BilingualController(document.body, () => {});
  controller.reconcile();
  expect(controller.takeBatch().map(r => r.block.text)).toEqual(['Article', 'Introduction', 'Content']);
  controller.clear();
});
it('只派发阅读窗口，滚动后重新选择，整篇模式仍排除站点导航', () => {
  document.body.innerHTML = '<header>Site menu</header><nav>Links</nav><main><article><header><h1>Title</h1></header><p>Near</p><p>Far</p></article><aside>Related</aside></main><footer>Legal</footer>';
  const far = document.querySelectorAll('p')[1];
  const rect = vi.spyOn(far, 'getBoundingClientRect').mockReturnValue({ top: 10000, bottom: 10100 } as DOMRect);
  const controller = new BilingualController(document.body, () => {});
  controller.reconcile(); expect(controller.status().count).toBe(3);
  expect(controller.takeBatch().map(r => r.block.text)).toEqual(['Title', 'Near']);
  expect(controller.takeBatch()).toEqual([]);
  rect.mockReturnValue({ top: -400, bottom: -300 } as DOMRect);
  expect(controller.takeBatch('reading', 1)).toEqual([]);
  expect(controller.takeBatch('reading', -1).map(r => r.block.text)).toEqual(['Far']);
  controller.clear(); controller.reconcile();
  rect.mockReturnValue({ top: 10000, bottom: 10100 } as DOMRect);
  expect(controller.takeBatch('article').map(r => r.block.text)).toContain('Far');
  controller.clear();
});
