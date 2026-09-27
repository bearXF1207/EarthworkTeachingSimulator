import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from './fileService';

/**
 * M10 受限 preload（sandbox + contextIsolation）：只暴露文件服务与关闭确认，
 * 不暴露 fs、shell、ipcRenderer 或任意通道。invoke 通道走白名单。
 */

const ALLOWED_CHANNELS: readonly string[] = [IPC.open, IPC.saveAs, IPC.saveExisting];

const invoke = (channel: string, payload?: unknown): Promise<unknown> => {
  if (!ALLOWED_CHANNELS.includes(channel)) return Promise.reject(new Error(`不允许的 IPC 通道：${channel}`));
  return ipcRenderer.invoke(channel, payload);
};

contextBridge.exposeInMainWorld('earthworkFileService', {
  open: (): Promise<unknown> => invoke(IPC.open),
  saveAs: (suggestedName: string, content: string): Promise<unknown> => invoke(IPC.saveAs, { suggestedName, content }),
  saveExisting: (filePath: string, content: string): Promise<unknown> => invoke(IPC.saveExisting, { filePath, content }),
});

contextBridge.exposeInMainWorld('earthworkWindow', {
  /** 订阅主进程的关闭请求；返回取消订阅函数。 */
  onRequestClose: (callback: () => void): (() => void) => {
    const listener = (): void => callback();
    ipcRenderer.on(IPC.closeRequest, listener);
    return () => { ipcRenderer.removeListener(IPC.closeRequest, listener); };
  },
  /** renderer 完成保存/放弃流程后确认关闭。 */
  confirmClose: (): void => { ipcRenderer.send(IPC.closeConfirm); },
});
