import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * M10 主进程文件服务的纯逻辑部分：不 import electron，也不 import src/**（保持 electron
 * 编译单元独立），可在 Vitest 中直接测试。electron 依赖（dialog/ipcMain）在 fileIpc.ts。
 * 通道名是 preload 与主进程的共同合同：preload 只放行白名单通道。
 */

/** 与 src/core/io/projectSchema.ts 的常量保持一致（tests/electronFileService.test.ts 断言相等）。 */
export const PROJECT_FILE_EXTENSION = '.excavation';
export const MAX_FILE_CHARACTERS = 8 * 1024 * 1024;

export const IPC = {
  open: 'earthwork:file:open',
  saveAs: 'earthwork:file:save-as',
  saveExisting: 'earthwork:file:save-existing',
  closeRequest: 'earthwork:window:close-requested',
  closeConfirm: 'earthwork:window:confirm-close',
} as const;

/** 与 projectSchema.MAX_FILE_CHARACTERS（8M 字符）对应：主进程按 UTF-8 最坏 3 字节/字符挡超大文件。 */
export const MAX_FILE_BYTES = MAX_FILE_CHARACTERS * 3;
/** 文件名长度与字符约束：只接受不含路径分隔符的安全基本名。 */
export const MAX_NAME_CHARACTERS = 200;

export const FILE_FILTERS = [{ name: '土方开挖工程', extensions: ['excavation', 'json'] }];

export type SaveAsPayload = { suggestedName: string; content: string };
export type SaveExistingPayload = { filePath: string; content: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 安全基本名：非空、无路径分隔符与控制字符、无首尾空白、不等于 "." / ".."。 */
export function isSafeBaseName(name: string): boolean {
  if (name.length === 0 || name.length > MAX_NAME_CHARACTERS) return false;
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(name)) return false;
  if (name !== name.trim()) return false;
  return name !== '.' && name !== '..';
}

/** 校验“另存为”载荷：内容是长度受限的字符串，建议名是安全基本名。 */
export function validateSaveAsPayload(value: unknown): SaveAsPayload | null {
  if (!isRecord(value)) return null;
  const { suggestedName, content } = value;
  if (typeof content !== 'string' || content.length > MAX_FILE_CHARACTERS) return null;
  if (typeof suggestedName !== 'string' || !isSafeBaseName(suggestedName)) return null;
  return { suggestedName, content };
}

/** 校验“写回原文件”载荷：路径必须是绝对路径且不含空字节；是否已授权由调用方（会话注册表）判断。 */
export function validateSaveExistingPayload(value: unknown): SaveExistingPayload | null {
  if (!isRecord(value)) return null;
  const { filePath, content } = value;
  if (typeof content !== 'string' || content.length > MAX_FILE_CHARACTERS) return null;
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 1024) return null;
  if (filePath.includes('\0') || !path.isAbsolute(filePath)) return null;
  return { filePath, content };
}

/** 建议名补上工程扩展名：保证另存为产物总是 .excavation。 */
export function withProjectExtension(suggestedName: string): string {
  return suggestedName.toLowerCase().endsWith(PROJECT_FILE_EXTENSION) ? suggestedName : suggestedName + PROJECT_FILE_EXTENSION;
}

/** 可注入的写入操作：默认走真实 fs；测试注入失败的 rename 验证“失败保留旧文件”。 */
export type AtomicWriteOps = {
  write: (tempPath: string, content: string) => Promise<void>;
  rename: (tempPath: string, targetPath: string) => Promise<void>;
  remove: (tempPath: string) => Promise<void>;
};

/** 默认实现：写临时文件 → fsync → 同目录重命名替换；Windows 下 rename 以 REPLACE_EXISTING 覆盖。 */
const defaultOps: AtomicWriteOps = {
  write: async (tempPath, content) => {
    const handle = await fs.open(tempPath, 'w');
    try {
      await handle.writeFile(content, 'utf8');
      // fsync 落盘后再替换，减少断电/崩溃时出现半个文件的窗口。
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  rename: (from, to) => fs.rename(from, to),
  remove: target => fs.rm(target, { force: true }),
};

/** 可恢复写入：同目录临时文件（隐藏名 + 随机后缀，避免并发冲突）→ 原子替换。
 * 任一步失败都清理临时文件并抛出；目标文件保持旧内容不变。
 */
export async function writeFileAtomic(targetPath: string, content: string, ops: AtomicWriteOps = defaultOps): Promise<void> {
  const tempPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`,
  );
  try {
    await ops.write(tempPath, content);
    await ops.rename(tempPath, targetPath);
  } catch (error) {
    await ops.remove(tempPath).catch(() => undefined);
    throw error;
  }
}
