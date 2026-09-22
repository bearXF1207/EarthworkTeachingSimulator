# M5 验证报告

日期：2026-09-22。范围：俯视单击绘制基槽、单击放置三类基坑、精确长度/角度输入、1m 网格吸附、吸附开关与快捷键焦点保护。不含 Raycasting 选择与高亮、基坑/节点拖动、节点增删与测量（M6 起）。M3/M4 的演示按钮已由正式绘制入口取代。

## 实现入口

| 文件 | 职责与后续执行方式 |
| --- | --- |
| `src/scene/DrawingManager.ts` | 工具状态机 `select \| drawTrench \| placePit \| measure`；节点追加去重、光标读数、预览点、焦点判定 |
| `src/scene/groundPointer.ts` | 画布 bounding rect → NDC → 地面 `z=0` 投影；越界、零尺寸与近无交点返回 null |
| `src/scene/PreviewLine.ts` | 未提交预览折线与起点像素标记，由 SceneManager 统一拥有与释放 |
| `src/scene/SceneManager.ts` | 新增 `preview`、`domElement`、`setPreviewPoints`，释放顺序含预览资源 |
| `src/core/geometry/pointMath.ts` | `snapPoint`、`nextPoint`、`segmentReport`、`polylineReport`、`shouldAppendNode`、`isDragGesture` |
| `src/core/model/project.ts` | `TrenchSection`、`PitDraftParams`、`defaultPitDraft`、`pitFromDraft`、`trenchFromDraft` |
| `src/components/DrawingPanel/DrawingPanel.tsx` | 工具切换、草稿读数、长度/角度输入与“添加下一点”、基坑类型与参数 |
| `src/components/SceneViewport.tsx` | 画布事件、Enter/Esc、视角切换与锁定、放置/完成/取消，移除演示入口 |
| `src/components/ViewControls/ViewControls.tsx` | 吸附开关；绘制期间锁定视角按钮 |
| `src/components/PropertyPanel/NumberFields.tsx` | 提交目标放宽为 `Result<unknown>`，供绘制草稿参数复用 |
| `src/store/ProjectStore.ts` | 新增 `snap` 命令，网格显隐与吸附相互独立 |
| `src/app/App.tsx` | 阶段徽标更新为 M5 |

## 核心设计说明

- 工具状态是判别联合，每种工具只保留自己的临时数据；切换工具、`Esc`、取消都会清空上一工具草稿。草稿不进入 `Project.elements`、历史或文件，只有成功完成/放置才派发一次 `add` 命令。
- 投影使用画布自身 bounding rect（不是窗口宽高）；越界与零尺寸直接返回 null。视线与地面接近平行时（`|n·d| < 1e-9`）交点会漂移到远处，同样按无交点处理，并与“只有俯视用于地面绘制”的视角判断形成双重保护。
- 双击分三层处理：忽略 `detail > 1` 的 click；忽略与末节点重合的位置；`dblclick`、`Enter` 与“完成基槽”按钮共用同一个 `finishTrench` 校验提交函数，不依赖最终校验去兜底重复点或生成半个对象。
- 拖动判定：`pointerdown` 与 `click` 之间位移超过 3 CSS 像素即按平移处理，因此绘制期间的平移与缩放不会落点。
- 精确输入按绝对方位角推算 `q = (p.x + L·cosθ, p.y + L·sinθ)`，θ 正规化到 `[0,360)`，结果**不做吸附**，长度不会被改写；鼠标点先投影到地面再按每轴 `Math.round(v/1)*1` 吸附，结果归一化 `-0`。
- 快捷键保护：`input/textarea/select/contenteditable` 以及 `isComposing`/`keyCode 229` 都不触发场景命令；输入框内 `Enter` 只提交输入段，`Esc` 不取消草稿，`Ctrl+Z` 仍归文本编辑。
- 预览与提交同源：预览折线来自同一草稿状态，基坑预览由 `pitFromDraft` + 槽顶轮廓生成，与提交使用同一个构造函数，避免预览与结果字段不一致。
- 进入绘制/放置工具自动切到俯视并锁定视角按钮，取消或完成后恢复进入前的视角；选中新对象，预览资源立即清空。

## 自动化验证

`npm run check` 通过：TypeScript、ESLint（零警告）、Vitest 8 文件 106 项、production build、dev/preview HTTP 冒烟。

新增 `tests/drawing.test.ts`（13 项）：

- 吸附：`(1.2,2.7)→(1,3)`，关闭时保留原值；负数与半格统一策略；`±0` 归一化。
- 精确输入：`(1,2)+8m/90° → (1,10)`，`(0,0)+12.5m/30° → (10.8253175473,6.25)`，长度保持 12.5；`-90/450/360` 正规化到 `270/90/0` 后得到同一下一点。
- 读数：段长与方位角保留完整精度并规范化（`(3,4)` 段 5m/53.1301023542°）。
- 状态机：第一次点击设置起点、后续追加；`detail=2` 与重合点都不追加；切换工具与取消清空草稿；预览折线不产生重复末点；读数同时给出已提交段与光标段；拖动超过阈值按平移处理。
- 焦点保护：`input/textarea/select/contenteditable` 判定为文本输入，`body`/`null` 不是。
- 投影：用相机自身投影反算画布坐标后，`(0,0)`、`(10,10)`、`(-12.5,7.25)`、`(100,-60)` 以及另一缩放比例的相机都能精确还原；画布外、零尺寸与近平行视线返回 null。

界面测试（`tests/app.test.tsx`）：M5 新增 8 项——三点绘制后 `Enter` 只产生一个三节点基槽且绘制期间锁定视角；真实双击序列（`click(1)`、`click(2)`、`dblclick`）不产生重复尾点或第二个对象；仅一个节点时提示“至少需要两个节点”且 `Esc` 不改变项目；拖动平移与画布外点击不落点；长度/角度输入推算下一点；`-90/450` 正规化；吸附开关只影响鼠标落点、输入框 `Enter` 提交输入段而不完成整槽、`Esc` 与输入法组合状态不误触发；三种基坑都能放置且重叠被拒绝并保持工具与模型。

M2/M3/M4 的核心测试全部保留。界面流程随入口变化做了调整：三类基坑与两种基槽改为绘制/放置创建，资源计数计入预览线（+2 几何、+2 材质），`NumberFields` 的落点校验仍由原有断言覆盖。

## 真实浏览器验收

在开发服务、真实 WebGL 画布中操作：

1. 进入“绘制基槽”自动切到俯视，`自由视角`等视角按钮被禁用；`Esc` 后恢复进入前的自由视角，项目内容不变。
2. 真实鼠标单击依次把草稿从 0、1、2 个节点推进；预览起点标记与橡皮筋跟随真实 `hover` 更新。
3. 按人工事件语义（pointerdown/up + `click(1)` + `click(2)` + `dblclick`）在 `(0,0)`、`(10,0)`、`(10,10)` 绘制：面板读数为“第 1 段：10.00m · 方位角 0.0°”“第 2 段：10.00m · 方位角 90.0°”，双击完成后恰好生成一个三节点折线基槽，没有重复尾点也没有第二个对象。
4. 工具自带的双击只产生一次 `detail=2` 的 click（与人工序列不同），应用按 `detail>1` 忽略，不产生多余节点——说明去重不依赖浏览器是否补发第一次 click。
5. 真实键盘：焦点在“本段长度/方位角”输入框时按 `Enter` 只提交输入段（读数 8.00m/90.0°，长度未被吸附改写），整槽未被完成；此时按 `Esc` 不取消草稿；焦点回到页身后 `Enter` 才触发完成校验。
6. 真实点击放置基坑：先吸附到整数中心（面板显示 `中心 X=20`、`中心 Y=0`）；在同一位置再次放置被拒绝，提示“`elements[2]：顶部开口与 <id> 重叠、包含或相切`”，对象数不变且放置工具保持。
7. 完成基槽时若候选与既有开口重叠，同样拒绝并把原因显示在绘制面板，草稿保留可继续修改。
8. 全程 `window` error、unhandledrejection 与 `console.error` 为空。唯一出现的 `OrbitControls.onPointerUp` 异常来自我用合成 `PointerEvent` 驱动的探针（指针未与捕获配对），真实鼠标事件下复现不出来。

## 已知边界

- 没有选择高亮、拖动节点/基坑、旋转操纵杆，也不能新增或删除单个节点；绘制中不能撤销上一节点（M6/M8）。
- 测量工具只有状态位与置灰按钮，M7 再实现长度/面积读数。
- 每完成一个对象都会重建全部几何与地面；本项目当前规模（少量对象、≤200 节点）可接受，未做增量更新。
- 绘制限定俯视：前/侧视不做地面绘制，符合设计；需要斜视观察时先完成对象再切换视角。
- 吸附只按 1m 网格，且不提供端点/水平/垂直吸附（原任务书已排除）。
- `PROJECT_SPEC.txt` 删除与 `PROJECT_SPEC.md` 未跟踪仍是工作区既有状态，不纳入提交。

## 下一阶段

M6 选择与编辑：用 Raycasting 选择对象并按稳定 ID 回查数据、高亮选中对象，属性面板支持基坑位置/旋转与基槽节点移动；拖动超过 3 CSS 像素才算拖动、只用预览线到释放时才提交一次动作。M5 已建立工具状态、投影、吸附与预览资源，M6 只需在同一状态机上增加 `select`/`dragNode`/`dragPit` 分支。
