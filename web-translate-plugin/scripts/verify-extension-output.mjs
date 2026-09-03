import { readFile, readdir } from 'node:fs/promises';
import { extname } from 'node:path';

const outputDirectory = new URL('../.output/chrome-mv3/', import.meta.url);
const textExtensions = new Set(['.css', '.html', '.js', '.json']);
const noncharacterFiles = [];

for (const file of await listFiles(outputDirectory)) {
  if (!textExtensions.has(extname(file.pathname))) continue;
  const text = await readFile(file, 'utf8');
  if (containsUnicodeNoncharacter(text)) noncharacterFiles.push(file.pathname);
}

if (noncharacterFiles.length > 0) {
  throw new Error(`生产产物包含 Unicode noncharacter：${noncharacterFiles.join(', ')}`);
}

const manifest = JSON.parse(await readFile(new URL('manifest.json', outputDirectory), 'utf8'));
if (Array.isArray(manifest.host_permissions) && manifest.host_permissions.length > 0) {
  throw new Error('生产 manifest 不得包含静态 host_permissions');
}
if (Array.isArray(manifest.content_scripts) && manifest.content_scripts.length > 0) {
  throw new Error('生产 manifest 不得包含静态 content_scripts');
}
if (manifest.options_ui?.page !== 'options.html' || manifest.options_ui?.open_in_tab !== true) {
  throw new Error('生产 manifest 必须把 options.html 配置为独立标签页');
}

console.log('生产产物验证通过：Unicode noncharacter=0，静态 host 权限=0，静态 content script=0，options 独立标签页=1');

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory);
    if (entry.isDirectory()) files.push(...await listFiles(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

function containsUnicodeNoncharacter(text) {
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (
      (codePoint >= 0xFDD0 && codePoint <= 0xFDEF) ||
      (codePoint >= 0xFFFE && (codePoint & 0xFFFF) >= 0xFFFE)
    ) return true;
  }
  return false;
}
