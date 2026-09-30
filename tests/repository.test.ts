// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const readme = readFileSync(path.join(root, 'README.md'), 'utf8');

describe('源码仓库使用说明', () => {
  it('README 中的本地文件链接都能在源码集合中找到', () => {
    const targets = [...readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
      .map(match => match[1]!).filter(target => !target.startsWith('#') && !/^https?:/.test(target));
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) expect(existsSync(path.join(root, target)), target).toBe(true);
  });

  it('README 中的 npm run 命令与实际脚本一致', () => {
    const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    const commands = [...readme.matchAll(/npm run ([\w:-]+)/g)].map(match => match[1]!);
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) expect(Object.hasOwn(manifest.scripts, command), command).toBe(true);
  });
});
