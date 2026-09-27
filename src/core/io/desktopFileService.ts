import { createBrowserFileGateway } from './fileGateway';
import type { FileGateway, FileHandle, OpenedFile, SaveOutcome, SaveRequest } from './fileGateway';
import type { Result } from '../model/project';

/**
 * M10 桌面文件适配器：Electron preload 通过 contextBridge 暴露 `window.earthworkFileService`。
 * 这里实现与浏览器版同一个 FileGateway 合同（kind='file-system'，保存返回可复用 target），
 * 业务核心不感知宿主是浏览器还是 Electron。
 * 应答类型与 electron/fileIpc.ts 的 OpenReply/SaveReply 镜像；两侧由各自测试对齐行为。
 */

export type DesktopOpenReply =
  | { status: 'cancelled' }
  | { status: 'ok'; name: string; text: string; path: string }
  | { status: 'error'; message: string };
export type DesktopSaveReply =
  | { status: 'cancelled' }
  | { status: 'ok'; name: string; path: string }
  | { status: 'error'; message: string };

export interface DesktopFileService {
  open(): Promise<DesktopOpenReply>;
  saveAs(suggestedName: string, content: string): Promise<DesktopSaveReply>;
  saveExisting(filePath: string, content: string): Promise<DesktopSaveReply>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** 结构化探测 preload 暴露的对象：三个方法齐全才认为桌面服务可用。 */
export function isDesktopFileService(value: unknown): value is DesktopFileService {
  if (!isRecord(value)) return false;
  return typeof value.open === 'function' && typeof value.saveAs === 'function' && typeof value.saveExisting === 'function';
}

const isOpenReply = (value: unknown): value is DesktopOpenReply => {
  if (!isRecord(value) || typeof value.status !== 'string') return false;
  if (value.status === 'cancelled') return true;
  if (value.status === 'error') return typeof value.message === 'string';
  return value.status === 'ok'
    && typeof value.name === 'string' && typeof value.text === 'string' && typeof value.path === 'string';
};
const isSaveReply = (value: unknown): value is DesktopSaveReply => {
  if (!isRecord(value) || typeof value.status !== 'string') return false;
  if (value.status === 'cancelled') return true;
  if (value.status === 'error') return typeof value.message === 'string';
  return value.status === 'ok' && typeof value.name === 'string' && typeof value.path === 'string';
};

/** 桌面句柄：在 FileHandle 形状之上携带主进程授权的绝对路径。 */
type DesktopFileHandle = FileHandle & { readonly earthworkPath: string };

const isDesktopHandle = (handle: FileHandle): handle is DesktopFileHandle =>
  'earthworkPath' in handle && typeof (handle as DesktopFileHandle).earthworkPath === 'string'
  && (handle as DesktopFileHandle).earthworkPath.length > 0;

const ioError = (message: string): Result<never> => ({ ok: false, issues: [{ code: 'io', path: '', message }] });

function desktopHandle(filePath: string, name: string, service: DesktopFileService): DesktopFileHandle {
  return {
    name,
    earthworkPath: filePath,
    // 桌面模式不通过句柄读文件：打开的内容已随 open 对话框一次性返回。
    getFile: async () => { throw new Error('桌面模式不支持句柄读取文件'); },
    createWritable: async () => {
      const chunks: string[] = [];
      return {
        write: async (data: string) => { chunks.push(data); },
        close: async () => {
          const reply = await service.saveExisting(filePath, chunks.join(''));
          if (reply.status === 'error') throw new Error(reply.message);
          if (reply.status !== 'ok') throw new Error('保存已取消');
        },
      };
    },
  };
}

export function createDesktopFileGateway(service: DesktopFileService): FileGateway {
  async function open(): Promise<Result<OpenedFile | null>> {
    const reply = await service.open();
    if (!isOpenReply(reply)) return ioError('桌面文件服务返回了无效的打开结果');
    if (reply.status === 'cancelled') return { ok: true, value: null };
    if (reply.status === 'error') return ioError(reply.message);
    return {
      ok: true,
      value: {
        name: reply.name,
        text: reply.text,
        target: { name: reply.name, handle: desktopHandle(reply.path, reply.name, service) },
      },
    };
  }

  async function save(request: SaveRequest): Promise<Result<SaveOutcome>> {
    const handle = request.target?.handle;
    if (handle && isDesktopHandle(handle)) {
      const reply = await service.saveExisting(handle.earthworkPath, request.text);
      if (!isSaveReply(reply)) return ioError('桌面文件服务返回了无效的保存结果');
      if (reply.status === 'error') return ioError(reply.message);
      if (reply.status === 'cancelled') return { ok: true, value: { status: 'cancelled' } };
      return { ok: true, value: { status: 'saved', file: { name: handle.name }, target: request.target! } };
    }
    const reply = await service.saveAs(request.suggestedName, request.text);
    if (!isSaveReply(reply)) return ioError('桌面文件服务返回了无效的保存结果');
    if (reply.status === 'error') return ioError(reply.message);
    if (reply.status === 'cancelled') return { ok: true, value: { status: 'cancelled' } };
    return {
      ok: true,
      value: {
        status: 'saved',
        file: { name: reply.name },
        target: { name: reply.name, handle: desktopHandle(reply.path, reply.name, service) },
      },
    };
  }

  return { kind: 'file-system', canReopen: true, open, save };
}

/** 宿主检测：有桌面文件服务用桌面网关，否则回到浏览器实现。 */
export function createFileGateway(): FileGateway {
  const candidate = (globalThis as { earthworkFileService?: unknown }).earthworkFileService;
  return isDesktopFileService(candidate) ? createDesktopFileGateway(candidate) : createBrowserFileGateway();
}
