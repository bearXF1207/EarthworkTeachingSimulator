import type { Result } from '../model/project';
import { PROJECT_FILE_EXTENSION } from './projectSchema';

/**
 * M8 文件服务：UI 只依赖这里的合同，不直接调用浏览器下载或文件句柄 API，
 * 也不假设一定有 File System Access（无该能力时回退为“请求下载”并如实返回 export-requested）。
 */

/** 当前写入目的地：只有文件句柄路径才可能“复用原文件”，下载回退没有可复用目的地。 */
export type SaveTarget = { name: string; handle: FileHandle };
export type SavedFile = { name: string };
export type SaveOutcome =
  /** 已确认写入：`target` 是可复用的写入目的地（下载回退不会返回 saved）。 */
  | { status: 'saved'; file: SavedFile; target: SaveTarget | null }
  | { status: 'cancelled' }
  | { status: 'export-requested'; file: SavedFile };
export type OpenedFile = { name: string; text: string; target: SaveTarget | null };
export type SaveRequest = { text: string; suggestedName: string; target: SaveTarget | null };

export interface FileGateway {
  /** 保存能力的类型：file-system 可直接写回原文件，download 只是请求浏览器下载副本。 */
  readonly kind: 'file-system' | 'download';
  readonly canReopen: boolean;
  open(): Promise<Result<OpenedFile | null>>;
  save(request: SaveRequest): Promise<Result<SaveOutcome>>;
}

/** 只声明用到的句柄能力，避免依赖浏览器实现细节与 lib 差异。 */
export type FileHandle = {
  name: string;
  getFile: () => Promise<{ name: string; text: () => Promise<string> }>;
  createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
};

type PickerGlobal = typeof globalThis & {
  showOpenFilePicker?: (options: unknown) => Promise<FileHandle[]>;
  showSaveFilePicker?: (options: unknown) => Promise<FileHandle>;
};
type InputGlobal = typeof globalThis & { document?: Document; window?: Window & typeof globalThis };

const PICKER_TYPES = [{
  description: '土方开挖工程',
  accept: { 'application/json': [PROJECT_FILE_EXTENSION, '.json'] },
}];

const ERROR_ISSUES = (path: string, message: string): Result<never> =>
  ({ ok: false, issues: [{ code: 'io', path, message }] });
const isAbort = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'name' in error && (error as { name?: unknown }).name === 'AbortError';
const describe = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** 无文件句柄能力时的兜底：把文本作为下载副本导出，无法确认用户是否最终保存。 */
function downloadCopy(text: string, name: string): void {
  const scope = globalThis as InputGlobal;
  const document = scope.document;
  if (!document) throw new Error('当前环境不支持下载导出');
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** 无文件句柄能力时的读取：用临时 file input；cancel 事件与窗口聚焦双保险识别取消。 */
function pickFile(): Promise<{ name: string; text: string } | null> {
  const scope = globalThis as InputGlobal;
  const { document, window } = scope;
  if (!document) return Promise.reject(new Error('当前环境不支持文件选择'));
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${PROJECT_FILE_EXTENSION},application/json`;
    let settled = false;
    const finish = (file: File | null): void => {
      if (settled) return;
      settled = true;
      input.remove();
      if (!file) { resolve(null); return; }
      file.text().then(text => resolve({ name: file.name, text })).catch(() => resolve(null));
    };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    // 部分浏览器没有 cancel 事件：窗口重新聚焦后仍无选择就按取消处理。
    window?.addEventListener('focus', () => setTimeout(() => finish(input.files?.[0] ?? null), 500), { once: true });
    input.style.display = 'none';
    document.body.append(input);
    input.click();
  });
}

/** 浏览器文件服务：优先 File System Access，缺失时回退到 file input + 下载副本。 */
export function createBrowserFileGateway(): FileGateway {
  const pickers = globalThis as PickerGlobal;
  const usesHandles = typeof pickers.showOpenFilePicker === 'function' || typeof pickers.showSaveFilePicker === 'function';

  async function open(): Promise<Result<OpenedFile | null>> {
    if (typeof pickers.showOpenFilePicker === 'function') {
      let handle: FileHandle;
      try {
        const handles = await pickers.showOpenFilePicker({ multiple: false, types: PICKER_TYPES });
        handle = handles[0]!;
      } catch (error) {
        if (isAbort(error)) return { ok: true, value: null };
        return ERROR_ISSUES('', `打开文件失败：${describe(error)}`);
      }
      try {
        const file = await handle.getFile();
        return { ok: true, value: { name: file.name, text: await file.text(), target: { name: file.name, handle } } };
      } catch (error) {
        return ERROR_ISSUES('', `读取文件失败：${describe(error)}`);
      }
    }
    try {
      const picked = await pickFile();
      return { ok: true, value: picked ? { ...picked, target: null } : null };
    } catch (error) {
      return ERROR_ISSUES('', `读取文件失败：${describe(error)}`);
    }
  }

  async function write(handle: FileHandle, text: string): Promise<void> {
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
  }

  async function save(request: SaveRequest): Promise<Result<SaveOutcome>> {
    const handle = request.target?.handle;
    if (handle) {
      try {
        await write(handle, request.text);
        return { ok: true, value: { status: 'saved', file: { name: request.target!.name }, target: request.target } };
      } catch (error) {
        return ERROR_ISSUES('', `写入原文件失败：${describe(error)}（已保留当前工程，请用“另存为”选择新位置）`);
      }
    }
    if (typeof pickers.showSaveFilePicker === 'function') {
      let picked: FileHandle;
      try {
        picked = await pickers.showSaveFilePicker({ suggestedName: request.suggestedName, types: PICKER_TYPES });
      } catch (error) {
        if (isAbort(error)) return { ok: true, value: { status: 'cancelled' } };
        return ERROR_ISSUES('', `保存失败：${describe(error)}`);
      }
      try {
        await write(picked, request.text);
        return { ok: true, value: { status: 'saved', file: { name: picked.name }, target: { name: picked.name, handle: picked } } };
      } catch (error) {
        return ERROR_ISSUES('', `写入文件失败：${describe(error)}`);
      }
    }
    try {
      downloadCopy(request.text, request.suggestedName);
    } catch (error) {
      return ERROR_ISSUES('', `导出失败：${describe(error)}`);
    }
    // 下载无法确认用户是否保存成功，因此只报告“已请求导出”，并由 UI 提供独立的“确认已导出”。
    return { ok: true, value: { status: 'export-requested', file: { name: request.suggestedName } } };
  }

  return { kind: usesHandles ? 'file-system' : 'download', canReopen: typeof pickers.showSaveFilePicker === 'function', open, save };
}
