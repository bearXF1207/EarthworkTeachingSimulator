# 土方开挖教学模拟器

用于理解平面布置、底部尺寸、开挖深度、放坡参数与三维形态/预计土方量之间的关系。目标是在 Windows 10/11 完全离线运行；最终通过 Electron 分发 Portable 应用。

**当前完成 M3：在 M2 三类参数化基坑之上加入两个节点的直线基槽（槽底、左右边坡、垂直端面、顶部开口、参数编辑），复用地面对不开孔、重叠校验与原子命令更新。保留 M1 四视角和镜头控制；折线基槽、鼠标绘制、计算、保存和 EXE 尚未实现。**

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
- [M1 验证报告](docs/M1_REPORT.md)：基础场景、16项测试及真实浏览器验收。
- [M2 验证报告](docs/M2_REPORT.md)：三类基坑、41项回归测试、100次更新和实际浏览器验收。
- [M3 验证报告](docs/M3_REPORT.md)：直线基槽几何/校验/开口、70项测试、真实浏览器端面与冲突验收。
- [仓库铁律](AGENTS.md)：改动需要相关测试和 Git commit。

后续执行 M4 时，先阅读设计的折线几何合同及手册 M4 章节，不因原任务书末尾的历史指令重新初始化项目。

### M3 操作

点击右侧“添加直线基槽”得到一条默认基槽（起点 `(-12,-20)`、终点 `(8,-20)`、底宽2m、深2m、坡比0.5），通过“当前对象”或直接编辑“起点/终点 X、Y”和底宽、深度、坡比修改；两个节点重合或段长不足 0.01m 会被拒绝并提示。基槽端面垂直，边坡水平外扩 = 深度 × 放坡系数，顶部宽度 = 底宽 + 2 × 深度 × 放坡系数。

三类基坑的添加方式与 M2 相同。任何顶部开口（基槽或基坑）与其他开口重叠、包含或相切都会被拒绝，并保留上一有效模型；删除后地面回填。切换实体/线框可检查槽底与端面，观察细节时在画布上滚轮放大。

“重新加载场景”仅重建图形资源并保留当前工程；浏览器刷新会清空内存工程。M8 才提供保存/打开和撤销历史。

## 目录

```text
src/
  main.tsx                 React 挂载入口
  app/                     应用组装和样式
  components/
    TopBar/ ToolPanel/ PropertyPanel/ ViewControls/ dialogs/
  core/
    model/ geometry/ calculation/ validation/ commands/ io/
  scene/                   相机、控制器、基坑/基槽 Mesh、带孔地面与资源管理
  store/                   ProjectStore 原子命令入口；M8 扩展历史
tests/                     Vitest 测试和 DOM 初始化
scripts/smoke.mjs          实际启动开发/预览服务器的 HTTP 验证
docs/                      校核、实施手册、阶段报告
electron/                  M10 占位说明，无 Electron 依赖或实现
```

空目录由 `.gitkeep` 纳入版本控制。业务数据和数学计算不依赖 React/Three；复杂几何不放入组件；SceneManager 从 M1 统一拥有 Three 对象与资源生命周期。

## 当前技术决策

保留原技术栈。校正一般矩形基坑体积公式；采用 XY 地面、Z 向上；基槽端面垂直；M2 起用二维地面孔洞显示开挖；M3 直线基槽与三类基坑共用同一个“底面+侧面环”实体构建器与同一套开口冲突判定；M4 限制 miter 并拒绝非法 offset；MVP 暂定拒绝重叠/相切开口。具体理由和数值测试见设计文档。

运行时使用系统字体及本地依赖，没有在线字体/贴图/CDN。M1/M2/M3 已做真实浏览器 WebGL 验收；当前测试不证明 Windows EXE、专业工程量或放坡安全性。构建仍有 Three 主包超过500kB的非阻塞体积提醒，未通过提高阈值隐藏。
