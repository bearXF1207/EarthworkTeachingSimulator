// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const doubles = vi.hoisted(() => ({
  spawn: vi.fn(), existsSync: vi.fn(), createRequire: vi.fn(),
  process: { execPath: 'test-node', env: {}, stdout: { write: vi.fn() }, exit: vi.fn(), on: vi.fn() },
}));
vi.mock('node:child_process', () => ({ spawn: doubles.spawn }));
vi.mock('node:fs', () => ({ existsSync: doubles.existsSync }));
vi.mock('node:module', () => ({ createRequire: doubles.createRequire }));
vi.mock('node:process', () => ({ default: doubles.process }));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  doubles.spawn.mockReset();
  doubles.existsSync.mockReturnValue(true);
  doubles.createRequire.mockReturnValue(() => 'test-electron');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('Electron 开发启动日志解析', () => {
  it.each([
    ['无颜色', '  Local:   http://127.0.0.1:5173/\n'],
    ['带 ANSI 颜色', '\u001B[32m  Local:\u001B[39m   \u001B[1;36mhttp://127.0.0.1:\u001B[1m5173\u001B[22m/\u001B[0m\n'],
  ])('%s日志中的地址用于启动 Electron', async (_label, log) => {
    const chunk = Buffer.from(log);
    const vite = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), exitCode: null, kill: vi.fn() });
    const electron = Object.assign(new EventEmitter(), { exitCode: null, kill: vi.fn() });
    doubles.spawn.mockImplementationOnce(() => {
      // 在真实脚本安装 stdout 监听后提供日志，不启动任何外部进程。
      Promise.resolve().then(() => { vite.stdout.emit('data', chunk); });
      return vite;
    }).mockReturnValueOnce(electron);

    const script = '../scripts/dev-electron.mjs';
    await import(script);

    expect(doubles.spawn).toHaveBeenCalledTimes(2);
    expect(doubles.spawn).toHaveBeenNthCalledWith(2, 'test-electron', [expect.stringMatching(/main\.js$/)],
      expect.objectContaining({ env: expect.objectContaining({ EARTHWORK_DEV_SERVER_URL: 'http://127.0.0.1:5173/' }) }));
    expect(doubles.process.stdout.write).toHaveBeenCalledWith(chunk);
    expect(vi.getTimerCount()).toBe(0);
  });
});
