# Electron 主进程与受限 preload（M10）

本目录承载桌面宿主：窗口、导航拦截、原生文件读写与关闭流程。**独立于 `src/**` 编译**（`electron/tsconfig.json`，CommonJS 输出到 `dist-electron/`），不 import 任何 renderer 代码；renderer 通过 `src/core/io/desktopFileService.ts` 暴露的同一个 `FileGateway` 合同使用它，业务核心不感知宿主。

## 文件

| 文件 | 职责 |
| --- | --- |
| `main.ts` | 创建窗口（1440×900，min 960×600）；生产加载 `dist/index.html`，开发用 `EARTHWORK_DEV_SERVER_URL`；`setWindowOpenHandler` 一律拒绝、`will-navigate` 仅放行 dev origin、禁 webview；生产移除应用菜单；关闭拦截与 `closeConfirmed`/`rendererAlive` 防循环标记 |
| `preload.ts` | 沙箱下只能 `require('electron')`，因此**自包含**（不 require 本地模块，通道常量内联，由 `tests/electronFileService.test.ts` 守护一致性）；只暴露 `earthworkFileService`（open/saveAs/saveExisting）与 `earthworkWindow`（onRequestClose/confirmClose），invoke 走通道白名单 |
| `fileService.ts` | 纯逻辑：IPC 通道常量、载荷校验（内容 ≤8M 字符、安全基本名、绝对路径、无空字节）、`writeFileAtomic`（同目录临时文件 → fsync → 重命名替换；失败清理临时文件并保留旧文件） |
| `fileIpc.ts` | IPC 装配：打开/另存为对话框（主进程读写文件并做大小检查）；会话级**授权路径注册表**——`save-existing` 只接受本会话经打开/另存为确认过的绝对路径，其余拒绝 |
| `tsconfig.json` | 独立编译配置（CommonJS + Node10 resolution + `ignoreDeprecations`）；`npm run build:electron` 编译后由 `scripts/finish-electron-build.mjs` 写入 `{"type":"commonjs"}` 标记（根 package.json 是 `"type":"module"`） |

## 安全边界

- renderer：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`——页面无 `require`/`process`/`ipcRenderer`。
- 页面可触达的只有上述六个函数；任意通道 invoke、fs、shell 均不可达。
- 文件大小上限与 `.excavation` 校验在主进程与 renderer 各自独立执行，任一侧拒绝即不落盘。

## 本地运行

```powershell
npm run build:electron   # 编译主进程/preload
npm run dev:electron     # 开发：vite + Electron 双启动
npm run package          # 生产：Portable EXE → release/
```

沙箱 preload 的 require 白名单只含 `electron`（及 events/timers/url），这是 `preload.ts` 不能引用 `fileService.ts` 的原因；修改通道常量时两处必须同步（测试会拦截不一致）。
