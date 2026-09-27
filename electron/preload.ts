import { contextBridge, ipcRenderer } from 'electron';

/**
 * M10 受限 preload（sandbox + contextIsolation）：只暴露文件服务与关闭确认，
 * 不暴露 fs、shell、ipcRenderer 或任意通道。invoke 通道走白名单。
 *
 * 沙箱模式的 preload 只能 require('electron')，不能 require 本地模块，
 * 因此通道常量在此内联；与 fileService.ts 的一致性由 tests/electronFileService.test.ts 守护。
 */

const CHANNELS = {
  open: 'earthwork:file:open',
  saveAs: 'earthwork:file:save-as',
  saveExisting: 'earthwork:file:save-existing',
  closeRequest: 'earthwork:window:close-requested',
  closeConfirm: 'earthwork:window:confirm-close',
} as const;

const ALLOWED_CHANNELS: readonly string[] = [CHANNELS.open, CHANNELS.saveAs, CHANNELS.saveExisting];

const invoke = (channel: string, payload?: unknown): Promise<unknown> => {
  if (!ALLOWED_CHANNELS.includes(channel)) return Promise.reject(new Error(`不允许的 IPC 通道：${channel}`));
  return ipcRenderer.invoke(channel, payload);
};

contextBridge.exposeInMainWorld('earthworkFileService', {
  open: (): Promise<unknown> => invoke(CHANNELS.open),
  saveAs: (suggestedName: string, content: string): Promise<unknown> => invoke(CHANNELS.saveAs, { suggestedName, content }),
  saveExisting: (filePath: string, content: string): Promise<unknown> => invoke(CHANNELS.saveExisting, { filePath, content }),
});

contextBridge.exposeInMainWorld('earthworkWindow', {
  /** 订阅主进程的关闭请求；返回取消订阅函数。 */
  onRequestClose: (callback: () => void): (() => void) => {
    const listener = (): void => callback();
    ipcRenderer.on(CHANNELS.closeRequest, listener);
    return () => { ipcRenderer.removeListener(CHANNELS.closeRequest, listener); };
  },
  /** renderer 完成保存/放弃流程后确认关闭。 */
  confirmClose: (): void => { ipcRenderer.send(CHANNELS.closeConfirm); },
});
