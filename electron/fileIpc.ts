import { app, dialog, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FILE_FILTERS, IPC, MAX_FILE_BYTES, validateSaveAsPayload, validateSaveExistingPayload, withProjectExtension, writeFileAtomic } from './fileService';

/**
 * M10 受限 IPC 文件服务：主进程读写文件，renderer 只拿到文本与文件名。
 * 安全边界：
 * - 载荷先过纯校验（大小、基本名、绝对路径），无效请求一律拒绝；
 * - “写回原文件”只允许本会话内经打开/另存为确认过的路径（授权注册表）；
 * - 打开文件限制字节数，避免超巨大输入拖垮进程；
 * - 所有读写都走 writeFileAtomic，失败保留旧文件并返回中文错误。
 */

/** 打开/保存的应答合同（renderer 侧在 desktopFileService.ts 有镜像声明，由测试对齐）。 */
export type OpenReply =
  | { status: 'cancelled' }
  | { status: 'ok'; name: string; text: string; path: string }
  | { status: 'error'; message: string };
export type SaveReply =
  | { status: 'cancelled' }
  | { status: 'ok'; name: string; path: string }
  | { status: 'error'; message: string };

/** 本会话已授权的可写目标（绝对路径）。每次注册时清空，进程生命周期内累积。 */
const authorizedPaths = new Set<string>();

const authorize = (filePath: string): string => {
  const resolved = path.resolve(filePath);
  authorizedPaths.add(resolved);
  return resolved;
};

const describe = (error: unknown): string => error instanceof Error ? error.message : String(error);

const defaultDir = (): string | undefined => {
  try {
    return app.getPath('documents');
  } catch {
    return undefined;
  }
};

async function readForOpen(filePath: string): Promise<OpenReply> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return { status: 'error', message: '所选路径不是文件' };
    if (stat.size > MAX_FILE_BYTES) {
      return { status: 'error', message: `文件过大（超过 ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)}MB 上限），已取消打开` };
    }
    const text = await fs.readFile(filePath, 'utf8');
    return { status: 'ok', name: path.basename(filePath), text, path: authorize(filePath) };
  } catch (error) {
    return { status: 'error', message: `读取文件失败：${describe(error)}` };
  }
}

export function registerFileIpc(getWindow: () => BrowserWindow | null): void {
  authorizedPaths.clear();

  ipcMain.handle(IPC.open, async (): Promise<OpenReply> => {
    const win = getWindow();
    if (!win) return { status: 'error', message: '窗口不可用，无法打开文件' };
    let filePaths: string[];
    const documents = defaultDir();
    try {
      const picked = await dialog.showOpenDialog(win, {
        title: '打开土方开挖工程',
        ...(documents ? { defaultPath: documents } : {}),
        filters: [...FILE_FILTERS],
        properties: ['openFile'],
      });
      if (picked.canceled || picked.filePaths.length === 0) return { status: 'cancelled' };
      filePaths = picked.filePaths;
    } catch (error) {
      return { status: 'error', message: `打开对话框失败：${describe(error)}` };
    }
    return readForOpen(filePaths[0]!);
  });

  ipcMain.handle(IPC.saveAs, async (_event, payload: unknown): Promise<SaveReply> => {
    const valid = validateSaveAsPayload(payload);
    if (!valid) return { status: 'error', message: '保存请求无效：内容或文件名不符合要求' };
    const win = getWindow();
    if (!win) return { status: 'error', message: '窗口不可用，无法保存文件' };
    const documents = defaultDir();
    let target: string;
    try {
      const picked = await dialog.showSaveDialog(win, {
        title: '保存土方开挖工程',
        ...(documents ? { defaultPath: path.join(documents, withProjectExtension(valid.suggestedName)) }
          : { defaultPath: withProjectExtension(valid.suggestedName) }),
        filters: [...FILE_FILTERS],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (picked.canceled || !picked.filePath) return { status: 'cancelled' };
      target = picked.filePath;
    } catch (error) {
      return { status: 'error', message: `保存对话框失败：${describe(error)}` };
    }
    try {
      await writeFileAtomic(target, valid.content);
    } catch (error) {
      return { status: 'error', message: `写入文件失败（原文件未改动）：${describe(error)}` };
    }
    return { status: 'ok', name: path.basename(target), path: authorize(target) };
  });

  ipcMain.handle(IPC.saveExisting, async (_event, payload: unknown): Promise<SaveReply> => {
    const valid = validateSaveExistingPayload(payload);
    if (!valid) return { status: 'error', message: '保存请求无效：内容或路径不符合要求' };
    const resolved = path.resolve(valid.filePath);
    if (!authorizedPaths.has(resolved)) {
      return { status: 'error', message: '目标文件未经授权：只能写回本会话中打开或另存为确认过的文件' };
    }
    try {
      await writeFileAtomic(resolved, valid.content);
    } catch (error) {
      return { status: 'error', message: `写入文件失败（原文件未改动）：${describe(error)}` };
    }
    return { status: 'ok', name: path.basename(resolved), path: resolved };
  });
}
