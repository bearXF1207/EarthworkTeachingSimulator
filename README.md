# 土方开挖教学模拟器

用于演示基坑、基槽的平面布置、开挖深度、放坡形态和预计土方量。支持三维查看、绘制与参数编辑、距离测量、工程保存及撤销重做。

Windows x64 便携版无需安装，复制 EXE 后双击运行；已有工程需另带对应的 `.excavation` 文件。运行时无需 Node.js 或网络。计算结果用于教学演示，不作为专业工程计价或施工安全依据。

## 开发

需要 Node.js 24.15–24.x、npm 11；具体 Node.js 版本记录在 [.node-version](.node-version)。

```powershell
npm ci
npm run dev
```

打开终端显示的本地地址。桌面开发模式：

```powershell
npm run build:electron
npm run dev:electron
```

## 验证与打包

```powershell
npm run check
npm run package
```

`check` 包含类型检查、ESLint、测试、网页与桌面构建，以及本地服务冒烟验证。修改代码需更新相关测试，通过验证后创建 Git commit。

Windows 打包结果位于 `release/`：

- `EarthworkTeachingSimulator-<版本>-x64-portable.exe`：免安装应用。
- `校验信息.txt`：构建信息和 SHA-256 校验值。

若下载 Electron 运行时超时，可使用已安装的同版本本地运行时打包：

```powershell
npm run build
npm run build:electron
node node_modules/electron-builder/cli.js --win portable --config.electronDist=node_modules/electron/dist
node scripts/release-info.mjs
```

## 仓库内容

- [src/](src/)：React 界面、Three.js 场景、几何计算与工程数据。
- [electron/](electron/)：桌面窗口、文件读写和 preload 桥接。
- [tests/](tests/)：单元、组件与桌面服务回归测试。
- [scripts/](scripts/)：开发启动、构建收尾、冒烟验证和发行校验脚本。
- [build/icon.ico](build/icon.ico)：打包所需的应用图标。
- 根目录配置与依赖锁文件：用于复现开发、测试和打包环境。

开发过程文档保留在本地，不纳入仓库；依赖、缓存及构建产物同样不提交。可执行文件适合通过 GitHub Releases 分发。
