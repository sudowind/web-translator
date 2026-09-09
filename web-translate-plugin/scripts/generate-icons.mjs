import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Chrome 的扩展图标使用 PNG；所有尺寸由同一个 SVG 源文件生成。
const brandDir = new URL('../public/brand/', import.meta.url);
const svg = await readFile(new URL('logo.svg', brandDir), 'utf8');
await mkdir(brandDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent('<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>' + svg);
    await page.screenshot({ path: fileURLToPath(new URL(`icon-${size}.png`, brandDir)), omitBackground: true });
  }
} finally { await browser.close(); }
console.log('已从 public/brand/logo.svg 生成 16 / 32 / 48 / 128 像素图标');
