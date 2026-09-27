# M10 Electron 与 Windows Portable 交付

M0–M9 已完成场景、几何、绘制/编辑、工程量、测量、文档能力与界面重构。M10 不改动任何几何算法与工程数据口径，把同一前端搬进 Electron 桌面宿主：受限 IPC、原生文件读写、可恢复写入、关闭保存流程与 Windows Portable EXE。

## 本阶段交付

- **独立编译的主进程/preload** `electron/main.ts` + `electron/preload.ts` + `electron/tsconfig.json`：CommonJS 产物输出到 `dist-electron/`（根 package.json 是 `"type":"module"`，由 `scripts/finish-electron-build.mjs` 写入局部 `{"type":"commonjs"}` 标记解决加载）；`npm run typecheck`/`check` 覆盖主进程类型检查。开发模式 `scripts/dev-electron.mjs` 双启动：先起 vite，从 stdout 剥离 ANSI 颜色码后匹配就绪地址，再用 `EARTHWORK_DEV_SERVER_URL` 指示 Electron 加载；退出 Electron 同时结束 vite，Ctrl+C 清理两个进程。生产模式加载 `dist/index.html` 本地文件。
- **隔离边界**：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`。preload **自包含**——沙箱 preload 的 require 白名单只有 `electron`，不能 require 本地模块，因此通道常量在 preload 内联，与 `fileService.ts` 的一致性由源文本测试守护（`tests/electronFileService.test.ts`）。页面上只有 `earthworkFileService`（open/saveAs/saveExisting）与 `earthworkWindow`（onRequestClose/confirmClose）六个函数，invoke 通道白名单外一律拒绝；不暴露 fs、shell、ipcRenderer 或任意通道。
- **主进程文件服务** `electron/fileService.ts` + `electron/fileIpc.ts`：打开/另存为走原生对话框，文件大小先 stat 检查再读；载荷校验（内容 ≤8M 字符、安全基本名禁路径分隔符与控制字符、绝对路径、无空字节）；**授权路径注册表**——`save-existing` 只接受本会话经打开/另存为确认过的绝对路径，renderer 即使被攻破也无法写任意路径。renderer 侧 `src/core/io/desktopFileService.ts` 实现同一个 `FileGateway` 合同并按宿主自动选择，业务核心不感知浏览器/Electron 差异。
- **可恢复写入**：目标目录内隐藏临时文件 → 写入并 fsync → 重命名替换；失败清理临时文件并抛错，旧工程文件保持原样。真实 fs 单测覆盖中文空格路径、替换、rename 失败、写失败、深层缺失目录（`tests/electronFileService.test.ts`）。
- **路径语义**：打开已有文件后 `保存` 写回原路径；新工程首次保存与另存为弹原生对话框并自动补 `.excavation` 扩展名；取消不改变 dirty 基线。
- **关闭流程**：主进程拦截 close，向 renderer 发送关闭请求；renderer 复用未保存对话框（保存/不保存/取消），保存真实写入成功后才 `confirmClose`，主进程置 `closeConfirmed` 后真正关窗；`rendererAlive` 标记与崩溃检查保证 renderer 未就绪/崩溃时直接放行，不会卡死关闭；`will-prevent-unload` 强制放行避免与浏览器式 beforeunload 双重弹窗。有对话框未决时忽略新的关闭请求。
- **导航与资源**：`setWindowOpenHandler` 一律拒绝、`will-navigate` 仅放行 dev origin、禁 `will-attach-webview`；生产移除应用菜单。图标（`build/icon.ico`，`scripts/make-icon.mjs` 纯 Node zlib 生成）、字体、Three.js、应用代码全部随包分发，无运行时外部依赖。
- **打包**：`npm run package` = build + build:electron + electron-builder portable（x64）+ `scripts/release-info.mjs`（写版本、说明、SHA-256 到 `release/校验信息.txt`）。`files` 白名单只含 `dist/**`、`dist-electron/**`、`package.json`，显式排除 node_modules/src/tests/electron，asar 开启，产物 `release/EarthworkTeachingSimulator-<版本>-x64-portable.exe`。

## 键设计

| 关注点 | 做法 |
| --- | --- |
| 沙箱 preload 不能 require 本地模块 | preload.ts 自包含（通道常量内联）；测试断言其源文本不含本地 import 且与 `IPC` 常量一致，防止两处漂移 |
| 业务核心不感知宿主 | `desktopFileService.ts` 实现与浏览器同一个 `FileGateway` 合同，`createFileGateway()` 按 `globalThis.earthworkFileService` 检测宿主；测试用结构探测而非 UA 判断 |
| renderer 被攻破也写不了任意路径 | 主进程会话级授权路径注册表：只有本会话经打开/另存为确认过的绝对路径可写回；未授权 `save-existing` 返回明确错误且不落盘 |
| 失败不损坏旧工程 | 原子写入 = 同目录临时文件 + fsync + 重命名；单测注入 rename/write 失败，断言旧内容保留、无临时残留 |
| 关闭回调不无限循环 | `closeConfirmed` + `rendererAlive` 双标记；renderer 崩溃/未加载直接放行；`will-prevent-unload` 强制放行避免双重弹窗 |
| ESM 仓库加载 CJS 主进程 | `dist-electron/package.json` 局部 `{"type":"commonjs"}`，不改源文件后缀，不影响根 ESM |
| 关闭对话框残留 | 继续/取消任一分支都先清 `pendingAction` 再执行动作；未决对话框期间忽略新关闭请求（app.test.tsx 覆盖） |

## 验证

`npm run check` 全绿：**19 文件 259 项测试**（新增 `tests/electronFileService.test.ts` 10 项、`tests/desktopBridge.test.ts` 8 项、`app.test.tsx` 增至 53 项含 4 项桌面关闭流程测试），含主进程类型检查、CJS 产物构建与 smoke。

**Electron 实机安全边界（生产配置 + 生产构建）8/8 通过**——以与 `main.ts` 一致的 webPreferences 加载 `dist/index.html`，同一份编译出的 `fileIpc.js` 装配：

- renderer 无 `require`/`process`，无 Node 全局；`ipcRenderer` 不可见。
- contextBridge 仅暴露声明的六个函数，键集合精确匹配。
- 生产页面加载成功、无 `ERR_FILE_NOT_FOUND`（截屏确认三列工作区正常渲染）。
- 新会话对 `C:/Windows/Temp/evil.excavation` 的写回被拒（「目标文件未经授权…」）且磁盘未产生文件。
- 越限载荷（9M 字符）与非文件名在弹对话框前被拒。
- 注册了 `earthwork:evil` handler，但页面无任何途径触达非白名单通道。

**dev 双启动冒烟**：`npm run dev:electron` 下 vite 就绪 → Electron 启动 → 窗口标题「土方开挖教学模拟器」正常，退出后 electron/node 进程全部清理。

**Portable EXE**：`npm run package` 产出 `release/EarthworkTeachingSimulator-0.10.0-x64-portable.exe`（大小与 SHA-256 见 `release/校验信息.txt`），`win-unpacked/土方开挖教学模拟器.exe` 可直接运行验证。

## 已知取舍与未完成验收（如实列出）

- **Windows 10/11 干净断网环境验收未执行**：本机只有开发环境（装有 Node.js），没有可用的干净独立测试机；「无 Node.js、断网、全新用户目录启动 EXE 完成教学流程」这一手册第 10 步验收未做，发行包的离线完整性目前只有"构建产物无外部 URL 引用 + production 加载本地资源通过"支撑。
- **原生对话框交互未人工走查**：中文/空格路径打开与保存 `教学案例 01.excavation`、关闭三选项的完整 UI 流程、保存失败（只读目录）保留窗口，这些依赖真实对话框操作的分支通过单元/组件测试与 Electron 逻辑测试覆盖，未在 EXE 里人工逐项点验。
- EXE 未做代码签名，首次运行可能触发 SmartScreen 提示（`校验信息.txt` 已注明）。
- 「Implicit publishing triggered by CI detection」来自 electron-builder 对 CI 环境变量的检测，`--publish` 行为在 v27 会变化；当前未发布任何通道，仅构建本地文件。
- 500 对象上限的性能未实测（与 M2–M9 一致，保护上限不是性能承诺）。
- 32 位 Windows 不支持（Electron 44 起移除 ia32），本阶段只交付 x64。
