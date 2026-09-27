import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/**
 * 打包后生成 release/校验信息.txt：版本号、构建时间、产物清单与 SHA-256。
 * 只校验 release 目录下本次生成的可执行文件，不写入其他内容。
 */

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { version, description } = require(path.join(root, 'package.json'));
const releaseDir = path.join(root, 'release');

if (!existsSync(releaseDir)) {
  console.error('release 目录不存在，请先运行 electron-builder');
  process.exit(1);
}

const executables = readdirSync(releaseDir)
  .filter(name => name.toLowerCase().endsWith('.exe'))
  .map(name => path.join(releaseDir, name))
  .filter(file => statSync(file).isFile());

if (executables.length === 0) {
  console.error('release 目录中没有找到 .exe 产物');
  process.exit(1);
}

const lines = [
  '土方开挖教学模拟器（Windows x64 Portable）',
  `说明：${description}`,
  `版本：${version}`,
  `构建时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
  '用法：免安装，双击 .exe 直接运行；无需 Node.js、无需联网、无登录。',
  '项目文件（.excavation）保存在用户选择的位置；保存采用临时文件+重命名，失败不会覆盖旧文件。',
  '首次运行未签名程序时 Windows 可能提示“更多信息 → 仍要运行”。',
  '',
  '文件校验（SHA-256）：',
];

for (const file of executables) {
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
  const size = statSync(file).size;
  lines.push(`${path.basename(file)}`);
  lines.push(`  SHA-256: ${hash}`);
  lines.push(`  大小: ${(size / 1024 / 1024).toFixed(1)} MB`);
}

const outFile = path.join(releaseDir, '校验信息.txt');
writeFileSync(outFile, lines.join('\n') + '\n', 'utf8');
console.log(`已生成 ${path.basename(outFile)}（共 ${executables.length} 个可执行文件）`);
