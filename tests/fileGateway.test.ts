import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserFileGateway } from '../src/core/io/fileGateway';
import type { FileHandle } from '../src/core/io/fileGateway';

/** 记录写入内容的假句柄。 */
const fakeHandle = (name: string, written: string[]): FileHandle => ({
  name,
  getFile: async () => ({ name, text: async () => written.join('') }),
  createWritable: async () => ({ write: async (data: string) => { written.push(data); }, close: async () => undefined }),
});
const abort = (): Error => new DOMException('用户取消', 'AbortError');

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('M8 文件服务：文件句柄路径', () => {
  it('有 showSaveFilePicker 时可写回并保留目的地；重复保存不再弹选择器', async () => {
    const written: string[] = [];
    const picker = vi.fn(async () => fakeHandle('工程.excavation', written));
    vi.stubGlobal('showSaveFilePicker', picker);
    const gateway = createBrowserFileGateway();
    expect(gateway.kind).toBe('file-system');
    expect(gateway.canReopen).toBe(true);

    const first = await gateway.save({ text: 'A', suggestedName: '工程.excavation', target: null });
    expect(first).toMatchObject({ ok: true, value: { status: 'saved', file: { name: '工程.excavation' } } });
    const target = first.ok && first.value.status === 'saved' ? first.value.target : null;
    expect(target).not.toBeNull();

    const second = await gateway.save({ text: 'B', suggestedName: '工程.excavation', target });
    expect(second.ok && second.value.status === 'saved').toBe(true);
    expect(picker).toHaveBeenCalledTimes(1); // 第二次复用原句柄
    expect(written).toEqual(['A', 'B']);
  });

  it('用户取消选择器返回 cancelled，写入失败返回外层错误（不清 dirty 由调用方决定）', async () => {
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => { throw abort(); }));
    const gateway = createBrowserFileGateway();
    expect(await gateway.save({ text: 'A', suggestedName: 'x.excavation', target: null }))
      .toMatchObject({ ok: true, value: { status: 'cancelled' } });

    vi.unstubAllGlobals();
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => ({
      name: 'x.excavation',
      createWritable: async () => { throw new Error('磁盘只读'); },
    })));
    const strict = createBrowserFileGateway();
    const failed = await strict.save({ text: 'A', suggestedName: 'x.excavation', target: null });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.issues[0]?.message).toContain('磁盘只读');
  });
});

describe('M8 文件服务：无文件句柄时的浏览器回退', () => {
  it('保存只请求下载副本并返回 export-requested，不声称写入成功', async () => {
    const created: string[] = [];
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => { created.push('blob'); return 'blob:copy'; }, revokeObjectURL: () => undefined });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const gateway = createBrowserFileGateway();
    expect(gateway.kind).toBe('download');
    expect(gateway.canReopen).toBe(false);
    const outcome = await gateway.save({ text: 'A', suggestedName: '副本.excavation', target: null });
    expect(outcome).toMatchObject({ ok: true, value: { status: 'export-requested', file: { name: '副本.excavation' } } });
    expect(click).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
  });

  it('打开使用临时 file input：取消事件解析为 null（保留当前工程）', async () => {
    const gateway = createBrowserFileGateway();
    const pending = gateway.open();
    const input = document.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    input!.dispatchEvent(new Event('cancel'));
    expect(await pending).toEqual({ ok: true, value: null });
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('有 showOpenFilePicker 时读取文本并返回可复用目的地', async () => {
    const text = '{"version":1}';
    vi.stubGlobal('showOpenFilePicker', vi.fn(async () => [{
      name: '工程.excavation', getFile: async () => ({ name: '工程.excavation', text: async () => text }),
    }]));
    const gateway = createBrowserFileGateway();
    const opened = await gateway.open();
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      expect(opened.value?.text).toBe(text);
      expect(opened.value?.target?.name).toBe('工程.excavation');
    }
    vi.unstubAllGlobals();
    vi.stubGlobal('showOpenFilePicker', vi.fn(async () => { throw abort(); }));
    const cancelled = await createBrowserFileGateway().open();
    expect(cancelled).toEqual({ ok: true, value: null });
  });
});
