# M0 完成与验证报告

完成日期：2026-09-22。范围：原始需求校核、详细执行文档、项目框架和 M0。**没有进入 M1。**

## 1. 已完成内容

- 建立根目录 Vite + React + TypeScript 项目，安装 Three.js 及对应类型。
- 启用 strict、noUncheckedIndexedAccess、exactOptionalPropertyTypes；应用/测试与工具配置均经过类型检查。未启用 skipLibCheck，也未关闭 strict 绕过类型错误。
- 配置 ESLint、Vitest、Testing Library 和 jsdom；提供统一 `npm run check`。
- 建立需求约定的组件、领域模型、几何、计算、验证、命令、IO、场景、store、测试和 Electron 预留目录。
- 完成中文最小首页，明确 M0 状态、教学用途、已接入依赖和后续范围；系统字体、本地资源、响应式布局。
- 编写 [技术校核与详细设计](TECHNICAL_DESIGN.md) 和 [M0–M10 逐阶段实施手册](MILESTONE_PLAYBOOK.md)。后者逐阶段列出前置条件、实现顺序、文件/函数职责、输入输出、数值/交互测试与停止条件。
- 编写 [README](../README.md)，说明环境、安装、启动、验证、目录和后续入口。

## 2. 关键校核结论

原技术栈可继续使用；已在执行设计中纠正/补齐以下问题，原始 `PROJECT_SPEC.txt` 保留原文：

1. 一般矩形基坑的上下矩形不相似，不能通用原棱台公式。正确公式为 `LWH+m(L+W)H²+(4/3)m²H³`；L=10/W=4/H=2/m=.5 得110.6666666667m³。
2. 完整不透明地面会遮住地下模型。M2 起采用二维开口三角化，并同步处理网格，不引入实体 CSG。
3. 全系统 XY 地面、Z 向上；俯视 camera.up 与其他视图不同，避免视线与 up 平行。
4. 基槽两端采用垂直端面；折线不仅检查中心线，还检查底/顶 offset 轮廓和边坡连接；miter 超限拒绝。
5. MVP 的实施约定是拒绝开口重叠/相切；圆形碰撞使用解析半径，显示和地面孔用96边形。
6. 项目动作入口从 M2 建立，M8 增加历史和文件功能；非法候选不覆盖有效工程。
7. 浏览器 Blob 下载只能返回“已请求导出”，不能确认成功写盘；不得自动清 dirty 或继续清空项目。

本次只编写后续行为的设计和验收用例，没有将 M2–M10 业务功能提前写入代码。

## 3. 文件和目录交付

| 类别 | 新增文件/目录 |
| --- | --- |
| 环境与依赖 | `package.json`、`package-lock.json`、`.node-version`、`.npmrc` |
| 类型与构建 | `tsconfig.json`、`tsconfig.app.json`、`tsconfig.node.json`、`vite.config.ts` |
| 代码质量 | `eslint.config.js`、`.gitignore`、`.gitattributes` |
| 运行入口 | `index.html`、`src/main.tsx`、`src/app/App.tsx`、`src/app/styles.css` |
| Three 集成 | `src/scene/runtimeInfo.ts`，只读取包版本，无场景实例 |
| 自动化验证 | `tests/setup.ts`、`tests/app.test.tsx`、`tests/three-integration.test.ts`、`scripts/smoke.mjs` |
| 后续目录 | `src/components/{TopBar,ToolPanel,PropertyPanel,ViewControls,dialogs}`、`src/core/{model,geometry,calculation,validation,commands,io}`、`src/store`，空目录由 `.gitkeep` 跟踪 |
| 文档 | `README.md`、`docs/TECHNICAL_DESIGN.md`、`docs/MILESTONE_PLAYBOOK.md`、本报告、`electron/README.md` |

`AGENTS.md` 沿用现有铁律。`dist/`、`node_modules/` 和本地缓存不纳入 Git。工作区中后来出现的 `PROJECT_SPEC.md` 不属于本轮生成文件，保留原状，不随 M0 提交。

## 4. 工具链与依赖

实测 Windows 开发环境：Node.js **24.21.0**，npm **11.19.0**。

| 类型 | 精确版本 |
| --- | --- |
| React / React DOM | 19.3.0 / 19.3.0 |
| Three.js / @types/three | 0.186.0 / 0.186.0 |
| Vite / @vitejs/plugin-react | 8.3.0 / 6.1.1 |
| TypeScript | 6.0.3 |
| ESLint / typescript-eslint | 10.11.0 / 8.70.0 |
| Vitest / jsdom | 4.1.11 / 30.1.0 |
| Testing Library React / jest-dom | 16.3.3 / 7.0.1 |

其余 React/Node 类型声明、ESLint 官方配置、globals、Hooks 和 Refresh 插件的完整版本以 package.json/lock 为准。

兼容性选择：typescript-eslint 当前声明支持 TypeScript `<6.1`，因此固定6.0.3；Vitest5 与 jest-dom7 的 Assertion 泛型声明不兼容，改用支持 Vite8 的 Vitest4.1.11。实际类型检查通过，不以忽略库类型掩盖不兼容。jsdom30 要求 Node24.15+，所以 engines 限制 Node `>=24.15.0 <25`。

## 5. 实际执行的验证

| 验证 | 实际结果 |
| --- | --- |
| `npm run check` | 通过；退出码0，串行完成类型、lint、测试、build、smoke |
| `npm run typecheck` | 通过，应用/测试/工具配置无 TS 错误 |
| `npm run lint` | 通过，0警告门槛 |
| `npm test` | 2个测试文件，3项测试通过 |
| `npm run build` | 成功，19个模块完成转换，生成 dist |
| `npm run smoke` | dev/preview 各自的首页与2个本地资产 HTTP 检查通过；临时服务自动关闭 |
| `npm ci --offline --no-audit` | 成功从已缓存依赖按锁文件重装251个包；随后再次运行完整 check 通过 |
| package/lock 一致性 | dependencies、devDependencies 和 engines 一致 |
| `npm run dev -- --port 5173` | 正常启动，真实浏览器显示中文首页与 M0 状态 |
| `npm run preview -- --port 4173` | 正常启动，真实浏览器验证生产首页正常 |
| 浏览器控制台 | dev 和 production 页面均未发现 warn/error |
| 响应式检查 | 1280×720 和390×844验证；文档宽度等于视口宽度，无横向溢出；已恢复浏览器默认尺寸 |
| 数学独立核算 | Node 直接计算矩形新/旧公式、圆台体积、96边形面积误差，与文档数值一致 |
| `git diff --check` | 通过；提交前另执行暂存区检查 |

3项自动测试：React 首页成功挂载及 Three 版本显示；当前阶段与未实现范围清楚；Three 核心/addons 可解析，BufferGeometry 可创建、求包围盒和释放。没有把 jsdom 或 CPU 几何测试当成真实 WebGL 验收。

生产产物：HTML约0.59KB，CSS约2.54KB，JS约221.83KB（gzip约69.77KB）。这些只是 M0 网页构建大小，不是最终 Electron 程序体积。

2026-09-21 安装时 npm audit 报告0个已知漏洞；离线重装使用 --no-audit，没有宣称重新联网审计。

## 6. 已知限制及下一阶段

当前 M0 无已知阻断错误。开发沙箱曾阻止 Vite 的子进程启动（spawn EPERM），经允许在沙箱外执行本机验证后通过；这不是应用代码错误。

M1 的 SceneManager、CameraManager、地面、网格、灯光、OrbitControls 尚未实现；坑槽几何、土方量、历史、项目文件和 Electron/EXE 也未实现。Windows10/11 独立离线发行验收留到 M10，不能由当前浏览器检查替代。

下一次执行 M1 时，按实施手册第3节完成基础场景、四视角、重置、显示控制接口和生命周期测试。开始前先读取主设计坐标及释放约定。M0 文件验证完成后作为一个完整改动提交，提交号可用 `git log -1 --oneline` 查看。
