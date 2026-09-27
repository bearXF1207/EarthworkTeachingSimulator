import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir, platform } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  IPC, MAX_FILE_BYTES, MAX_FILE_CHARACTERS as MAX_CHARS_ELECTRON, PROJECT_FILE_EXTENSION as EXT_ELECTRON,
  isSafeBaseName, validateSaveAsPayload, validateSaveExistingPayload, withProjectExtension, writeFileAtomic,
} from '../electron/fileService';
import { MAX_FILE_CHARACTERS, PROJECT_FILE_EXTENSION } from '../src/core/io/projectSchema';

/** M10 主进程文件服务纯逻辑：载荷校验与可恢复写入。真实 fs + 注入失败，验证“失败保留旧文件”。 */

const created: string[] = [];
const makeDir = async (name = 'case'): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'earthwork-file-'));
  created.push(root);
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  return dir;
};

afterEach(async () => {
  const pending = created.splice(0);
  await Promise.all(pending.map(dir => rm(dir, { recursive: true, force: true })));
});

describe('M10 IPC 载荷校验', () => {
  it('主进程与 renderer 的工程文件常量保持一致（扩展名、字符上限、字节预算）', () => {
    expect(EXT_ELECTRON).toBe(PROJECT_FILE_EXTENSION);
    expect(MAX_CHARS_ELECTRON).toBe(MAX_FILE_CHARACTERS);
    expect(MAX_FILE_BYTES).toBe(MAX_FILE_CHARACTERS * 3);
  });

  it('preload 自包含：沙箱下不能 require 本地模块，通道常量必须与 fileService 保持一致', async () => {
    const preloadSource = await readFile(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'electron', 'preload.ts'), 'utf8');
    expect(preloadSource).not.toMatch(/from '\.\//); // preload 不允许引入任何本地模块
    for (const channel of Object.values(IPC)) expect(preloadSource).toContain(`'${channel}'`);
    expect(preloadSource).toContain("exposeInMainWorld('earthworkFileService'");
    expect(preloadSource).toContain("exposeInMainWorld('earthworkWindow'");
  });

  it('另存为载荷：合法中文与空格基本名通过，路径分隔符/越界内容/非字符串拒绝', () => {
    expect(validateSaveAsPayload({ suggestedName: '教学案例 01.excavation', content: '{"version":1}' }))
      .toEqual({ suggestedName: '教学案例 01.excavation', content: '{"version":1}' });
    expect(validateSaveAsPayload(null)).toBeNull();
    expect(validateSaveAsPayload('x')).toBeNull();
    expect(validateSaveAsPayload({ suggestedName: 'a/b.excavation', content: '{}' })).toBeNull();
    expect(validateSaveAsPayload({ suggestedName: 'a\\b.excavation', content: '{}' })).toBeNull();
    expect(validateSaveAsPayload({ suggestedName: '..', content: '{}' })).toBeNull();
    expect(validateSaveAsPayload({ suggestedName: ' x.excavation', content: '{}' })).toBeNull();
    expect(validateSaveAsPayload({ suggestedName: 'x.excavation', content: 42 })).toBeNull();
    expect(validateSaveAsPayload({ suggestedName: 'x.excavation', content: 'a'.repeat(MAX_FILE_CHARACTERS + 1) })).toBeNull();
    expect(validateSaveAsPayload({ suggestedName: 'x'.repeat(201), content: '{}' })).toBeNull();
    expect(isSafeBaseName('教学案例 01.excavation')).toBe(true);
    expect(isSafeBaseName('')).toBe(false);
  });

  it('写回载荷：只接受不含空字节的绝对路径，内容同样受限', () => {
    const absolute = platform() === 'win32' ? 'C:\\数据\\工程.excavation' : '/data/工程.excavation';
    expect(validateSaveExistingPayload({ filePath: absolute, content: '{}' })).toEqual({ filePath: absolute, content: '{}' });
    expect(validateSaveExistingPayload({ filePath: 'relative/x.excavation', content: '{}' })).toBeNull();
    expect(validateSaveExistingPayload({ filePath: 'C:\\a\0b.excavation', content: '{}' })).toBeNull();
    expect(validateSaveExistingPayload({ filePath: 123, content: '{}' })).toBeNull();
    expect(validateSaveExistingPayload({ filePath: absolute, content: null })).toBeNull();
  });

  it('建议名缺少扩展名时补 .excavation，已有则原样保留', () => {
    expect(withProjectExtension('教学案例 01')).toBe('教学案例 01.excavation');
    expect(withProjectExtension('教学案例 01.excavation')).toBe('教学案例 01.excavation');
  });
});

describe('M10 可恢复写入（真实文件系统）', () => {
  it('中文与空格路径写入成功：目标内容正确且不留临时文件', async () => {
    const base = await makeDir('教学案例 目录');
    const target = path.join(base, '教学案例 01.excavation');
    await writeFileAtomic(target, '{"version":1}');
    await expect(readFile(target, 'utf8')).resolves.toBe('{"version":1}');
    await expect(readdir(base)).resolves.toEqual(['教学案例 01.excavation']);
  });

  it('替换已有文件：旧内容被完整替换，无临时残留', async () => {
    const base = await makeDir();
    const target = path.join(base, '工程.excavation');
    await writeFile(target, 'old-content', 'utf8');
    await writeFileAtomic(target, 'new-content');
    await expect(readFile(target, 'utf8')).resolves.toBe('new-content');
    await expect(readdir(base)).resolves.toEqual(['工程.excavation']);
  });

  it('替换失败保留旧文件并清理临时文件（断电安全路径由临时文件+重命名保证）', async () => {
    const base = await makeDir();
    const target = path.join(base, '工程.excavation');
    await writeFile(target, 'old-content', 'utf8');
    const written: string[] = [];
    await expect(writeFileAtomic(target, 'new-content', {
      write: async (tempPath, content) => { written.push(tempPath); await writeFile(tempPath, content, 'utf8'); },
      rename: async () => { throw new Error('文件被占用'); },
      remove: tempPath => rm(tempPath, { force: true }),
    })).rejects.toThrow('文件被占用');
    await expect(readFile(target, 'utf8')).resolves.toBe('old-content');
    await expect(readdir(base)).resolves.toEqual(['工程.excavation']);
    expect(written).toHaveLength(1);
  });

  it('写临时文件失败时同样清理并抛出，目标不产生', async () => {
    const base = await makeDir();
    const target = path.join(base, '工程.excavation');
    await expect(writeFileAtomic(target, 'x', {
      write: async () => { throw new Error('磁盘已满'); },
      rename: async () => undefined,
      remove: async () => undefined,
    })).rejects.toThrow('磁盘已满');
    await expect(readdir(base)).resolves.toEqual([]);
  });

  it('深层中文路径不存在时失败并抛出（主进程负责提示，不静默建目录）', async () => {
    const base = await makeDir('中文 空格');
    const target = path.join(base, '缺失目录', '工程.excavation');
    await expect(writeFileAtomic(target, 'x')).rejects.toThrow();
  });
});
