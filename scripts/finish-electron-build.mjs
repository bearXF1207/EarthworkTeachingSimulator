import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * electron 产物收尾：根 package.json 是 ESM（"type":"module"），而主进程/preload 必须是 CJS
 * （sandbox preload 只支持 CJS）。在 dist-electron 内放置 {"type":"commonjs"}，
 * 使其中的 .js 按 CommonJS 加载，避免改名 .cjs 带来的路径漂移。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'dist-electron');
const missing = ['main.js', 'preload.js'].filter(name => !existsSync(path.join(outDir, name)));
if (missing.length > 0) {
  console.error(`dist-electron 缺少 ${missing.join('、')}，请先运行 tsc -p electron`);
  process.exit(1);
}
writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');
console.log('dist-electron: main.js / preload.js / package.json(type=commonjs) 就绪');
