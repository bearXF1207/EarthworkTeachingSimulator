import { Menu, app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import process from 'node:process';
import { IPC } from './fileService';
import { registerFileIpc } from './fileIpc';

/**
 * M10 主进程：窗口、安全边界与关闭流程。
 * - 开发模式通过 EARTHWORK_DEV_SERVER_URL 加载 vite 开发服务；生产加载本地 dist/index.html；
 * - contextIsolation + sandbox，renderer 无 Node 集成，preload 只暴露窄文件服务；
 * - 阻止新窗口与任何非预期导航；关闭走 renderer 的保存/不保存/取消流程。
 */

const DEV_SERVER_URL = process.env.EARTHWORK_DEV_SERVER_URL?.trim() || '';

let mainWindow: BrowserWindow | null = null;
/** 受控关闭标记：只有 renderer 确认（保存成功或放弃修改）后才允许真正关闭，防止关闭回调循环。 */
let closeConfirmed = false;
/** renderer 就绪标记：页面未加载完成/已崩溃/加载失败时直接放行关闭，避免窗口永远关不掉。 */
let rendererAlive = false;

const isAllowedDevUrl = (url: string): boolean => {
  if (!DEV_SERVER_URL) return false;
  try {
    return new URL(url).origin === new URL(DEV_SERVER_URL).origin;
  } catch {
    return false;
  }
};

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: '土方开挖教学模拟器',
    backgroundColor: '#f4f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      spellcheck: false,
    },
  });
  mainWindow = win;
  closeConfirmed = false;
  rendererAlive = false;

  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-finish-load', () => { rendererAlive = true; });
  win.webContents.on('did-fail-load', () => { rendererAlive = false; });
  win.webContents.on('render-process-gone', () => { rendererAlive = false; });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // 桌面模式的关闭确认由应用内对话框完成，绕过 beforeunload 的浏览器原生提醒，避免双重弹窗。
  win.webContents.on('will-prevent-unload', event => event.preventDefault());
  win.webContents.on('will-navigate', (event, url) => {
    if (isAllowedDevUrl(url)) return;
    event.preventDefault();
  });
  win.on('close', event => {
    if (closeConfirmed || !rendererAlive || win.webContents.isCrashed()) return;
    event.preventDefault();
    win.webContents.send(IPC.closeRequest);
  });

  if (DEV_SERVER_URL) void win.loadURL(DEV_SERVER_URL);
  else void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.on('web-contents-created', (_event, contents) => {
  // 禁止任何 <webview> 附加：教学应用不需要嵌入外部内容。
  contents.on('will-attach-webview', event => event.preventDefault());
});

ipcMain.on(IPC.closeConfirm, () => {
  closeConfirmed = true;
  mainWindow?.close();
});

app.whenReady().then(() => {
  registerFileIpc(() => mainWindow);
  // 生产模式移除默认菜单（避免暴露 reload/devtools）；开发模式保留以便调试。
  if (!DEV_SERVER_URL) Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
