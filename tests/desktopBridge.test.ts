import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDesktopFileGateway, createFileGateway, isDesktopFileService } from '../src/core/io/desktopFileService';
import type { DesktopFileService } from '../src/core/io/desktopFileService';
import type { FileHandle, SaveTarget } from '../src/core/io/fileGateway';

/** M10 桌面文件网关：与 FileGateway 合同对齐（取消/错误/保存回写/另存为新目的地）。 */

const fakeService = (overrides: Partial<DesktopFileService> = {}): DesktopFileService => ({
  open: vi.fn(async (): Promise<{ status: 'cancelled' }> => ({ status: 'cancelled' })),
  saveAs: vi.fn(async (): Promise<{ status: 'cancelled' }> => ({ status: 'cancelled' })),
  saveExisting: vi.fn(async () => ({ status: 'ok' as const, name: '工程.excavation', path: 'C:\\数据\\工程.excavation' })),
  ...overrides,
});

/** 测试用手写桌面句柄：形状满足 FileHandle，并携带桌面网关用于路由的授权路径。 */
const desktopTarget = (name: string, filePath: string): SaveTarget => {
  const handle: FileHandle & { earthworkPath: string } = {
    name,
    earthworkPath: filePath,
    getFile: async () => { throw new Error('unused'); },
    createWritable: async () => ({ write: async () => undefined, close: async () => undefined }),
  };
  return { name, handle };
};

afterEach(() => {
  delete (globalThis as { earthworkFileService?: unknown }).earthworkFileService;
  vi.restoreAllMocks();
});

describe('M10 桌面服务探测与宿主选择', () => {
  it('三个方法齐全才识别为桌面服务', () => {
    expect(isDesktopFileService(undefined)).toBe(false);
    expect(isDesktopFileService({})).toBe(false);
    expect(isDesktopFileService({ open: () => undefined, saveAs: () => undefined })).toBe(false);
    expect(isDesktopFileService(fakeService())).toBe(true);
  });

  it('无 preload 对象时回退浏览器网关；有 preload 对象时使用桌面网关', () => {
    // jsdom 没有 File System Access：浏览器网关是 download 回退。
    expect(createFileGateway().kind).toBe('download');
    (globalThis as { earthworkFileService?: unknown }).earthworkFileService = fakeService();
    const gateway = createFileGateway();
    expect(gateway.kind).toBe('file-system');
    expect(gateway.canReopen).toBe(true);
  });
});

describe('M10 桌面网关：open', () => {
  it('用户取消映射为 null（保留当前工程）', async () => {
    const gateway = createDesktopFileGateway(fakeService());
    await expect(gateway.open()).resolves.toEqual({ ok: true, value: null });
  });

  it('打开成功返回文本与可复用目的地（句柄携带授权路径）', async () => {
    const service = fakeService({
      open: vi.fn(async () => ({ status: 'ok' as const, name: '教学案例 01.excavation', text: '{"version":1}', path: 'C:\\教学\\案例.excavation' })),
    });
    const opened = await createDesktopFileGateway(service).open();
    expect(opened.ok).toBe(true);
    if (opened.ok && opened.value) {
      expect(opened.value.name).toBe('教学案例 01.excavation');
      expect(opened.value.text).toBe('{"version":1}');
      expect(opened.value.target?.name).toBe('教学案例 01.excavation');
    }
  });

  it('主进程错误与无效应答都返回外层失败，不抛出', async () => {
    const failed = await createDesktopFileGateway(fakeService({
      open: vi.fn(async () => ({ status: 'error' as const, message: '文件过大' })),
    })).open();
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.issues[0]?.message).toBe('文件过大');

    const invalid = await createDesktopFileGateway(fakeService({
      open: vi.fn(async () => ({ status: 'ok', name: 'x' }) as unknown as Awaited<ReturnType<DesktopFileService['open']>>),
    })).open();
    expect(invalid.ok).toBe(false);
  });
});

describe('M10 桌面网关：save', () => {
  it('带目的地保存走写回原路径，并原样保留 target', async () => {
    const saveExisting = vi.fn(async () => ({ status: 'ok' as const, name: '工程.excavation', path: 'C:\\数据\\工程.excavation' }));
    const service = fakeService({
      open: vi.fn(async () => ({ status: 'ok' as const, name: '工程.excavation', text: 'OLD', path: 'C:\\数据\\工程.excavation' })),
      saveExisting,
    });
    const gateway = createDesktopFileGateway(service);
    const opened = await gateway.open();
    const target = opened.ok && opened.value ? opened.value.target : null;
    expect(target).not.toBeNull();
    saveExisting.mockClear();

    const saved = await gateway.save({ text: 'NEW', suggestedName: '工程.excavation', target });
    expect(saveExisting).toHaveBeenCalledWith('C:\\数据\\工程.excavation', 'NEW');
    expect(saved).toMatchObject({ ok: true, value: { status: 'saved', file: { name: '工程.excavation' } } });
    if (saved.ok && saved.value.status === 'saved') expect(saved.value.target).toBe(target);
  });

  it('无目的地保存走另存为，成功后返回新目的地供后续写回', async () => {
    const saveAs = vi.fn(async () => ({ status: 'ok' as const, name: '副本.excavation', path: 'C:\\数据\\副本.excavation' }));
    const gateway = createDesktopFileGateway(fakeService({ saveAs }));
    const saved = await gateway.save({ text: 'A', suggestedName: '副本.excavation', target: null });
    expect(saveAs).toHaveBeenCalledWith('副本.excavation', 'A');
    expect(saved.ok && saved.value.status === 'saved').toBe(true);
    if (saved.ok && saved.value.status === 'saved') {
      expect(saved.value.target?.name).toBe('副本.excavation');
      // 第二次保存应复用新目的地：句柄携带授权路径。
      const second = await gateway.save({ text: 'B', suggestedName: '副本.excavation', target: saved.value.target });
      expect(second.ok && second.value.status === 'saved').toBe(true);
    }
  });

  it('取消与写回失败分别映射为 cancelled 与外层错误', async () => {
    const cancelled = await createDesktopFileGateway(fakeService()).save({ text: 'A', suggestedName: 'x.excavation', target: null });
    expect(cancelled).toEqual({ ok: true, value: { status: 'cancelled' } });

    const failed = await createDesktopFileGateway(fakeService({
      saveExisting: vi.fn(async () => ({ status: 'error' as const, message: '写入文件失败（原文件未改动）：文件被占用' })),
    })).save({ text: 'A', suggestedName: 'x.excavation', target: desktopTarget('x.excavation', 'C:\\x.excavation') });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.issues[0]?.message).toContain('文件被占用');
  });
});
