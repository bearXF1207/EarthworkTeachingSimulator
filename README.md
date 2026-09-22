# 土方开挖教学模拟器

用于理解平面布置、底部尺寸、开挖深度、放坡参数与三维形态/预计土方量之间的关系。目标是在 Windows 10/11 完全离线运行；最终通过 Electron 分发 Portable 应用。

**当前只完成 M0：开发环境、项目框架和最小首页。尚无三维场景、绘制、计算、保存或 EXE。**

## 快速开始

开发环境：Node.js 24.15–24.x、npm 11；本机验证版本见 [M0 报告](docs/M0_REPORT.md)。`.node-version` 记录本次具体 Node 版本；如果所用版本管理器不识别该文件，请手动选择对应版本。

在仓库根目录运行：

```powershell
npm ci
npm run dev
```

打开终端显示的本地地址（默认 `http://127.0.0.1:5173`）。如端口被占用，使用 `npm run dev -- --port 5174`。按 Ctrl+C 关闭。安装依赖通常需要网络，安装后运行应用不依赖外部服务。

不要双击 `dist/index.html` 验证网页构建；浏览器模块安全限制可能阻止 file 协议模块加载。网页构建用 `npm run preview`，最终本地桌面加载在 M10 验收。

## 检查命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动本地开发服务器 |
| `npm run typecheck` | 检查应用、测试及 Vite 配置的 TypeScript 类型 |
| `npm run lint` | ESLint；警告同样使命令失败 |
| `npm test` | 单次运行单元/组件测试 |
| `npm run test:watch` | 测试监听模式 |
| `npm run build` | 类型检查后生成 `dist/` |
| `npm run preview` | 预览已经生成的构建 |
| `npm run smoke` | 检查 dev/preview 的首页和本地资产；需先 build；自动关闭测试服务 |
| `npm run check` | 依次 typecheck → lint → test → build → smoke，失败立即停止 |

依赖采用精确版本和 npm 锁文件。更换机器使用 `npm ci`；不要顺手升级 TypeScript 7，它超出当前 typescript-eslint 的支持范围。Node 低于24.15会因测试环境依赖要求被拒绝。

## 文档与执行入口

- [原始需求](PROJECT_SPEC.txt)：保留用户原文。
- [技术校核与详细设计](docs/TECHNICAL_DESIGN.md)：技术风险修正、数学推导、模块协议、数值边界、几何/交互/文件设计和官方依据。
- [逐阶段实施手册](docs/MILESTONE_PLAYBOOK.md)：M0–M10 的顺序任务、文件/函数入口、具体验收用例、完成门槛和后续请求模板。
- [M0 验证报告](docs/M0_REPORT.md)：本轮完成范围、工具版本、实际测试结果和已知限制。
- [仓库铁律](AGENTS.md)：改动需要相关测试和 Git commit。

后续执行 M1 时，先阅读设计第5、10节及手册 M1 章节，不因原任务书末尾的历史指令重新初始化项目。

## 目录

```text
src/
  main.tsx                 React 挂载入口
  app/                     应用组装、M0 首页和样式
  components/
    TopBar/ ToolPanel/ PropertyPanel/ ViewControls/ dialogs/
  core/
    model/ geometry/ calculation/ validation/ commands/ io/
  scene/                   Three 适配；M0 仅 runtimeInfo.ts
  store/                   后续纯数据状态与订阅
tests/                     Vitest 测试和 DOM 初始化
scripts/smoke.mjs          实际启动开发/预览服务器的 HTTP 验证
docs/                      校核、实施手册、阶段报告
electron/                  M10 占位说明，无 Electron 依赖或实现
```

空目录由 `.gitkeep` 纳入版本控制。业务数据和数学计算不依赖 React/Three；复杂几何不放入组件；SceneManager 从 M1 统一拥有 Three 对象与资源生命周期。

## 当前技术决策

保留原技术栈。校正一般矩形基坑体积公式；采用 XY 地面、Z 向上；基槽端面垂直；M2 起用二维地面孔洞显示开挖；M4 限制 miter 并拒绝非法 offset；MVP 暂定拒绝重叠/相切开口。具体理由和数值测试见设计文档。

运行时使用系统字体及本地依赖，没有在线字体/贴图/CDN。当前测试不证明真实 WebGL、Windows EXE、专业工程量或放坡安全性；这些不属于 M0 验收范围。
