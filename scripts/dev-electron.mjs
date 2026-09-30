import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

/**
 * M10 开发模式双启动：先确认主进程/preload 已编译，再启动 vite dev server，
 * 等它就绪后用 EARTHWORK_DEV_SERVER_URL 指示 Electron 加载开发地址。
 * 退出 Electron 会同时结束 vite；Ctrl+C 同样清理两个进程。
 */

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const electronBinary = require('electron');
const mainEntry = path.join(root, 'dist-electron', 'main.js');
const preloadEntry = path.join(root, 'dist-electron', 'preload.js');

if (!existsSync(mainEntry) || !existsSync(preloadEntry)) {
  console.error('dist-electron 缺少 main.js/preload.js，请先运行: npm run build:electron');
  process.exit(1);
}

const viteScript = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const vite = spawn(process.execPath, [viteScript, '--host', '127.0.0.1'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });

const devUrl = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('vite dev server 30s 内未就绪')), 30_000);
  vite.stdout.on('data', chunk => {
    process.stdout.write(chunk);
    // vite 输出带 ANSI 颜色码（Local: 与 URL 之间夹着转义序列），先剥离再匹配。
    const text = stripVTControlCharacters(String(chunk));
    const match = /Local:\s+(http:\/\/127\.0\.0\.1:\d+\/)/.exec(text);
    if (match) { clearTimeout(timer); resolve(match[1]); }
  });
  vite.once('exit', code => { clearTimeout(timer); reject(new Error(`vite 提前退出（${code}）`)); });
});

console.log(`启动 Electron（开发模式，加载 ${devUrl}）`);
const child = spawn(electronBinary, [mainEntry], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, EARTHWORK_DEV_SERVER_URL: devUrl },
});

const stopVite = () => { if (vite.exitCode === null) vite.kill(); };
child.on('exit', code => { stopVite(); process.exitCode = code ?? 0; });
vite.on('exit', () => { if (child.exitCode === null) child.kill(); });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { child.kill(); stopVite(); process.exit(1); });
}
