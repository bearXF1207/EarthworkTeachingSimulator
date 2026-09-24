# 土方开挖教学模拟器：技术校核与实施设计

状态：2026-09-21，设计基线 v1；代码已实现至 **M7**（见 `README.md` 与各阶段报告）。M8–M10 是后续执行合同，不代表已经实现。M5/M6 追加的环形基槽、自动收边与拖动编辑以 `docs/M5_REPORT.md`、`docs/M6_REPORT.md` 的记录为准；M7 的土方量与测量见 `docs/M7_REPORT.md`；2026-09-24 的接口真实贯通与计量修正见 §7.6 与 `docs/JUNCTION_FIX_REPORT.md`（`M5_REPORT.md` 中"端面省略"的旧结论已勘误失效）。

## 1. 如何使用这套文档

1. 阅读根目录 `AGENTS.md`，遵守每次完成改动后测试、验证、提交的要求。
2. 阅读本文件，理解校核结论和统一约定。
3. 阅读 `MILESTONE_PLAYBOOK.md`，只执行用户本次指定的阶段。
4. 用手册各阶段的测试表核对行为；M0 实际结果见 `M0_REPORT.md`。
5. 每个完整改动运行 `npm run check`，修复失败，再手工/浏览器验收、更新报告并提交。

根目录 `PROJECT_SPEC.md` 是保留原文的需求来源（早期的 `PROJECT_SPEC.txt` 已被其取代并从版本库中移除），其中“现在执行……”是原任务书内容。本轮执行范围由用户当前请求确定。后续 AI 不得因为读到原文中的指令就跳过校核或重建仓库。

本文修正原文中的数学错误，并把原文未定义的行为写成明确的**实施约定**。涉及参数上限、相交对象策略、性能目标的约定可在对应里程碑开始前调整，但必须同步改文档和测试。

## 2. 技术路线校核结论

保留 React + TypeScript + Three.js + Vite，网页核心稳定后于 M10 接 Electron。适合本地教学模拟；Electron 捆绑浏览器和 Node 运行时，最终用户无需自行安装 Node，但程序体积和内存消耗不等同于原生小工具。“轻量”解释为不引入大型引擎、服务端和额外后台服务，而不是保证几 MB 的 EXE。

| 原文位置 | 问题及影响 | 本设计的处理 | 落地阶段 |
| --- | --- | --- | --- |
| §41 | 一般矩形基坑上下矩形不相似，给出的棱台体积公式不适用 | 对水平截面面积积分，使用下文矩形公式；方形为特例 | M7，M2 先固定形状 |
| §28 | 完整不透明地面遮住地下模型；透明叠加也可能错序 | M1 完整地面，M2 起二维地面多边形挖孔并三角化，不做实体 CSG | M2 |
| §10/14/31 | 工程 Z 向上，而 Three 默认 Y 向上，俯视相机 up 与视线平行会奇异 | 全系统工程/场景均 XY 平面、Z 向上，按视图单独设置相机 up | M1 |
| §16/17 | 中心线合法不保证 offset 轮廓合法，尖角、折返、短段可产生尖刺 | miter 有上限，检查底/顶轮廓、边界间关系及塌缩；非法编辑不落盘 | M4 |
| §15/39 | 起终端面是否放坡未定义，纵向放坡会改变体积 | MVP 基槽端面垂直，顶底端点同站位（butt cap） | M3 |
| §38–42 | 相邻对象可重复计量，地面孔可相交 | MVP 暂定拒绝开口重叠、包含和相切，避免把相加结果当并集 | M2–M6 |
| §37/69 | 可变项目状态和动作入口若等到 M8 才做，会返工编辑逻辑 | M2 建最小数据 store + command seam，M8 增加历史和文件适配 | M2/M8 |
| §45/51 | JSON 示例省略 settings；TypeScript 类型不能校验外部 JSON | version=1，settings 必填；unknown 解析、完整运行时验证、限额、拒绝未来版本 | M8 |
| §4/55 | React 严格模式会重复 setup/cleanup，GPU 资源可能泄漏 | SceneManager 独占场景，幂等 dispose，挂载卸载测试 | M1 |
| §2/71 | 浏览器文件能力与 Electron 不同；离线不是不安装开发依赖 | FileGateway 统一合同；运行资产全本地，开发可联网装依赖 | M8/M10 |

没有必要为 M0 引入 React Three Fiber、物理引擎、状态管理库、CSG 库、数据库或后端。使用原生 Three.js API；状态先用纯 TypeScript store + React `useSyncExternalStore`，确有瓶颈后再评估额外库。

## 3. 范围、工具与版本管理

- 根目录直接作为 Vite 项目，避免再嵌套一个同名项目目录。
- 开发环境基线为 Node.js 24 LTS（至少 24.15）和 npm 11；当前实测版本以 M0 报告为准。TypeScript 固定在 ESLint 插件支持的 6.0 系列，不能独立升级到 7。
- 依赖写入 `package.json`，精确版本及传递依赖由 `package-lock.json` 锁定。复现使用 `npm ci`，不在后续阶段自动升级依赖。
- React 管 UI；Three 管显示；纯 TypeScript 管数据、几何算法和计算；Vite 管编译/本地开发。
- Vitest 管单元/组件测试；Testing Library 用用户可观察的角色/文本断言；Node 脚本检查 dev/preview 和静态资产。
- ESLint 禁止 explicit any，检查 Hooks；TypeScript strict 并开启 `noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`。
- `build` 必须先 typecheck，因为 Vite 的 TS 转译不替代类型检查。
- 页面无在线字体、CDN、远程贴图、遥测。`base: './'` 为后续本地资源提供相对路径。
- M0 不安装 Electron，不创建假 main/preload 实现；只保留带说明的 `electron/` 目录。

## 4. 层次与文件职责

```text
React components → app actions → store / command dispatcher → Project (plain data)
                                                ↓ validated commit
                              geometry + calculation (pure functions)
                                                ↓ disposable render artifacts
                         SceneManager → Three renderer / helpers / cameras

FileGateway → parse unknown → validate Project → replace through command/store
```

| 路径 | 所属责任 | 不得承担 |
| --- | --- | --- |
| `src/app/` | 应用组装、错误边界、阶段入口 | 计算多边形或土方量 |
| `src/components/TopBar/` 等 | 控件与输入草稿、显示结果 | 直接增删 Scene |
| `src/core/model/` | Project / element / settings / Point2 类型、默认值 | DOM、React、Three 引用 |
| `src/core/validation/` | 数值、折线、多边形、项目文件校验 | 静默修正用户非法几何 |
| `src/core/geometry/` | offset、join、坑槽几何生成、收边（`trenchTrim`）与接口派生并集（`trenchNetwork`/`convexExcavation`，纯数值、不依赖 Three） | 保存 Mesh、读取 UI 状态 |
| `src/core/calculation/` | 长度、面积、体积、距离纯函数 | 从 Mesh 包围盒倒推工程量 |
| `src/core/commands/` | 原子编辑动作、历史快照（M8） | 操作 GPU |
| `src/core/io/` | schema、序列化、FileGateway 合同 | React UI、任意系统路径读取 |
| `src/scene/` | SceneManager、CameraManager、GroundManager、选择/绘制适配 | 把 Three 对象写入 Project |
| `src/store/` | 文档状态、订阅、经验证的状态替换 | 持有可变 Scene/Mesh |
| `electron/` | M10 才实现 main/preload、本地文件权限 | 在 renderer 启用 Node |
| `tests/` | 单元/组件测试、未来几何/IO/交互回归 | 把 mock WebGL 成功当成 GPU 验收 |
```

M0 空目录使用 `.gitkeep` 保留；不得在文件里塞占位“成功”实现。新增公共函数需有显式返回类型。几何生成允许在独立模块返回 BufferGeometry，但 polylineOffset/joinSolver 等算法不依赖 Three；计算完全不依赖 Three。

## 5. 坐标、单位、角度和数值边界

### 5.1 全局约定

- 米为长度单位，平方米/立方米为面积/体积。数据不提前四舍五入，UI 默认显示 2 位小数。
- 右手系：XY 地面，Z 向上；地面 z=0，槽底/坑底 z=-depth。
- 项目中 Point2 = `{ x: number; y: number }`，传入 Three 为 `(x,y,z)`，不偷偷交换轴。
- 用户输入及保存文件的 `rotation` 均为**度**，正规化到 `[0,360)`；传给 Three/三角函数时仅转换一次为弧度。
- 精确绘制角度为绝对方位：0°沿 +X，90°沿 +Y，逆时针为正。
- 下一点 `q = (p.x + L cos θ, p.y + L sin θ)`；精确输入结果**不再进行网格吸附**，否则长度/角度会被破坏。
- 鼠标放置点先投影到地面，再按每轴 `Math.round(value / spacing) * spacing` 吸附。间距默认 1m，支持开/关。

### 5.2 数值实施限额

| 参数 | 合法范围 | 检查时机 |
| --- | --- | --- |
| 坐标 x/y 及派生轮廓坐标 | 有限数，绝对值 ≤10000m | 输入、命令、导入、生成 |
| 底长/底宽/底边/直径/深度 | `[0.02,1000]` m | 同上 |
| 坡比 m | `[0,5]`，0 合法 | 同上 |
| 单段中心线长度 | `>0.01m` | 每次新增/编辑、导入 |
| 单槽节点 | 2–200 | 创建、导入 |
| 项目元素 | 0–500；ID 唯一非空 | 创建、导入 |
| 文件体积 | UTF-8 ≤10MiB | 读入后解析前，Electron 尽量读前 stat |
| 几何 epsilon | `1e-7m`，面积按距离容差与边长尺度判断 | 几何谓词，不用于 UI 四舍五入 |
| miter 比值 | ≤4（miter 长 / 半宽） | 每个转角 |

这些是教学工具可维护性的初始上限，不是工程规范。过大参数需给出中文错误和可接受范围，不能截断成另一个用户未输入的值。先用 `Number.isFinite`，再比较；禁止以 truthiness 判断数字。输入空字符串保留为 UI 草稿，不得 `Number('')` 变成 0。未知 JSON 的 `null`、字符串数字、对象/数组错型全部拒绝。

## 6. 数据和动作合同（M2 起逐步实现）

```ts
type Point2 = Readonly<{ x: number; y: number }>;
type ProjectSettings = {
  gridVisible: boolean;
  snapEnabled: boolean;
  snapSpacing: 1;
  groundSize: number; // 初始 100；可按开口边界自动扩展
};
type Project = {
  version: 1;
  name: string;
  units: 'm';
  elements: ExcavationElement[];
  settings: ProjectSettings;
};
type ValidationIssue = { code: string; path: string; message: string };
type Result<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };
```

四种元素字段沿用原文 §47–50，以 `type` 判别联合；rotation 单位见上文。ID 由动作层 `crypto.randomUUID()` 创建，在撤销/重做中保持不变。项目根对象不含相机、Mesh、选中状态、鼠标预览或文件路径。

编辑入口统一为 `dispatch(command): Result<Project>`：

1. 从当前数据生成候选 Project；不直接修改旧对象。
2. 数值/拓扑/开口冲突校验。
3. 生成候选几何；失败时释放候选资源，保持原数据、原 Mesh 和选择状态。
4. 成功后提交数据并交换渲染资源；销毁旧对象专属资源。
5. M8 扩展该入口记录历史，而不是重写所有 UI 事件。

UI 文本框、拖动位置和绘制中的折线都是临时 draft。未通过提交校验的 draft 不进 Project、不影响正式体积、不进历史。删除对象同时清除选择和控制点。模型更新返回 objectId→Mesh 映射，raycast 通过持久 ID 找数据。

## 7. 几何合同

### 7.1 输出和边界

建议各生成器返回 `{ geometry, topOutline, bottomOutline }`，两轮廓为 XY 坐标点序列，末点不重复首点，统一逆时针。`geometry` 只包含坑底、侧坡、槽端面，**没有封住开口的顶盖**。有材质组区分槽底与边坡。

地面轮廓和模型开口必须使用同一份派生坐标，不能各算一份。检查所有 position/normal 有限，index 在范围内，无零面积三角形。底面法向朝上，坡面朝开挖空间；先校验绕序，不用 DoubleSide 掩盖错误。测试体积时临时补顶部盖用于有向四面体积分，显示模型保持开口。

### 7.2 方形和矩形基坑

局部底部四角 `(±L/2,±W/2,-H)`，顶部四角 `(±(L/2+mH),±(W/2+mH),0)`。方形令 L=W=bottomSize。先生成局部点，再绕 +Z 转 rotation，最后平移 position。

坑底用两个三角形；四侧各两个三角形，按法向验收。深度/底宽变化后重建，不用 scale 蒙混不同放坡几何。例：4×4、H=2、m=.5，顶边6；10×4、H=2、m=.5，顶为12×6。

### 7.3 圆形基坑

`r=bottomDiameter/2`，`R=r+mH`。初始固定 96 段圆周，共享顶底相同角度采样；底面扇形，侧面成对三角形。`topOutline` 使用同样的 96 点让地面严丝合缝。显示是多边形近似，体积仍用解析圆台公式；96 边形面积相对误差约 0.0714%，验收允许网格体积与解析值偏差 <0.1%。不可把离散圆写成 96 个可编辑工程节点。

### 7.4 直线基槽

设 `d=(p1-p0)/L`，左法向 `n=(-d.y,d.x)`，底半宽 b=B/2，顶半宽 t=b+mH。端点左右边界分别为 `p ± n*b` 与 `p ± n*t`，对应 z=-H/0。生成槽底、左右坡、起终垂直端面；不开顶盖。垂直端面不沿 d 方向扩展。

### 7.5 折线基槽

禁止曲线，输入只有折线。执行顺序必须一致：

1. 校验节点、段长，禁止连续/非连续重复节点、非相邻段交叉/接触/共线重叠。相邻段只允许共享唯一端点。
2. 求各段单位方向 d 和左法向 n；转角 `turn=atan2(cross(d0,d1),dot(d0,d1))`。turn≈0 是合法直行；`abs(turn)`≈π 是折返，不能混为同一类。
3. 内部节点令 `j=normalize(n0+n1)`，`denom=dot(j,n1)`。denom 接近0、非有限或 `1/abs(denom)>4` 时拒绝。相应内夹角 `π-abs(turn)` 至少10°，但 miterLimit=4 通常更严格。
4. 每个半宽 w，偏移点为 `p ± j*w/denom`；端点使用所属第一/末段法向，形成 butt cap。底/顶使用同一 join 决策，保持节点一一对应。
5. 沿左侧正序、右侧逆序构成闭合环；该构造通常是顺时针，检查 signed area 后将顶/底环同步反转到逆时针并保留对应索引。校验两个环简单、不相切、不塌缩，短段的前后 join 不倒序。
6. 当 m>0 时顶环应包含底环，边界仅允许约定的端部同站位接触；检查对应横向边界不交叉。m=0 顶底 XY 重合合法。
7. 校验顶轮廓与其他元素开口无交/包含/相切，校验派生坐标范围；失败返回明确错误，保留旧对象。
8. 对简单槽底环三角化；连接对应底/顶边生成侧面与端面；检查三角形绕序和零面积，再交给 SceneManager。

MVP 不在异常时自动切 bevel：bevel 会改变顶点对应和局部面连接，须另设计并测试后才能加入。合法的90°、45°、钝角应成功；折返、offset 自交的窄 U 形应明确拒绝。直线共线中间节点可保留，去除产生的共线退化三角形；禁止静默删除用户有效控制节点。

### 7.6 基槽接口连接（派生并集，2026-09-24）

两条基槽"顶口相接"不等于槽底连通：端面省略只会露出主槽坡墙，深度越深留下的土楔越宽（`m·H`）。因此接口按**派生几何**处理，不写回存储的中心线：

1. `trenchTrim` 先把新槽端部收边到相邻槽顶开口之外，并沿被越过边界的法向让出 10nm 级净距。端面垂直支槽中心线（butt cap），与斜交边界不可能共面：收边后端点位于边界外侧 `顶半宽×|u·ĥ|`、远端角点最多两倍（`u` 为支槽向外方向、`ĥ` 为边界方向）。
2. `trenchNetwork` 按"贴合带"识别接口：端面两角点落在**同一条**邻槽顶边界、沿边位置在跨度内、支槽朝槽内、近端角点贴住边界（≤ 净距带），远端角点不超过 `min(2×顶半宽×|u·ĥ|, 0.25m)`。判定同时接受精确贴合与收边留下的外偏，真实绘制的微小倾角因此可以贯通；"停在边界外 2cm 的垂直端面"或"斜交且远离边界"不会被误判。
3. 识别到接口后构造**连接凸单元**：从支槽端面沿中心线延伸到主槽中心线；`convexExcavation` 用半空间裁剪去掉内部面（两侧相反的公共墙同时删除、同向重合外表面只留一份），得到并集面片供渲染，并积分出并集体积。
4. `core/calculation/quantities` 的 `connectionCorrection = 并集体积 − 各凸单元体积之和`，即接口处真正新增的开挖量；`项目合计 = 单槽估算之和 + 连接补挖量`，不重复计入已有槽体。显示与计量共用同一份缓存（按内容为键，编辑或重排不复用陈旧结果）。
5. 派生几何有面片数量上限；`volumeSummary` 在并集触发守卫时退回单槽估算并标记降级，渲染期不因计量失败中断（`ErrorBoundary` 兜底）。
6. 深浅槽只在共同深度内贯通，更深处保留台阶；仅角点接触、平行槽口并排贴边不算接口，也不扩大既有地面开口。需要一般斜交或任意交叉开挖时，须另行扩展开口合并合同。

## 8. 地面开口与对象相交

M1 是完整水平平面。M2 引入 `GroundManager`：取足够大的矩形外边界（默认100m方形，超范围按所有开口 AABB 向外至少10m扩展），使用开口集合构建 holes，然后调用 `ShapeUtils.triangulateShape(contour, holes)` 构建 z=0 地面 BufferGeometry。外环和孔采用相反绕序，遵守所选三角化 API 的输入约定。

采用二维带孔三角化；不用 CSG 计算大地实体。官方 API 支持 holes，但不承诺修复非法轮廓，因此先校验：孔互不相交、互不包含、互不相切，全部严格处于外环内。场地网格不可跨开口浮在坑上：M2 起按相同孔轮廓裁剪网格线段，或使用仅作用于地面的程序化网格；手册以裁剪网格线为默认方案。

多边形开口判交必须结合边段相交和点在多边形内，不能只检查 AABB。相切按 epsilon 视为冲突。一个很小的基坑完全在另一个坑里也必须拒绝。圆的96边形只用于显示和地面孔；碰撞使用解析顶半径：圆–圆当圆心距离 ≤R1+R2+epsilon 时拒绝；圆–多边形当圆心在多边形内，或圆心到任意边段距离 ≤R+epsilon 时拒绝（包含多边形整体位于圆内的情形）。因此不会漏过圆弧与内接弦之间的交叠。MVP 总量为已接受、不重叠对象体积之和，不能称为任意布置的布尔并集体积。

## 9. 计算公式与独立数值验收

### 9.1 基槽

`T=B+2Hm`；`A=(B+T)H/2=BH+mH²`；`V=A ΣL`。对垂直端面的直线槽为精确值；折线对批准的规则给出教学估算，不宣称一般重叠扣减已经实现。

- L=20、B=2、H=2、m=.5：T=4，A=6，V=120m³。
- (0,0)→(10,0)→(10,10)，相同截面：L=20，V≈120m³。
- 原文 §43 的示例 L=25.60、B=2、H=1.5、m=.5：T=3.5，A=4.125，**V=105.60m³**，此例正确。

### 9.2 一般矩形（纠正 §41）

从坑底向上量 s，截面 `A(s)=(L+2ms)(W+2ms)`，s∈[0,H]。积分得到：

```text
V = LWH + m(L+W)H² + (4/3)m²H³
  = H/6 × (A底 + 4A中 + A顶)
A中 = (L+mH)(W+mH)
```

`H/3(A底+A顶+sqrt(A底*A顶))` 要求上下截面相似；等水平外扩的非正方形矩形通常不相似，不能使用。方形和圆形符合相似截面条件。

- L=10、W=4、H=2、m=.5：A底40、A中55、A顶72，**V=110.6666666667m³**；错误公式约110.4437543067m³。
- 方形4×4、H=2、m=.5：**V=50.6666666667m³**。
- L=10、W=4、H=2、m=0：**V=80m³**。

这是基于任务书几何定义的解析推导，不是引用计价规范。

### 9.3 圆形、测量和误差

`V=πH(R²+Rr+r²)/3`。底直径4、H=2、m=.5：r=2、R=3，V=38π/3≈39.7935069455m³。

工程合计在单槽估算之上叠加接口处的**连接补挖量**：`合计 = Σ单槽估算 + (并集体积 − 各凸单元体积之和)`。补挖量来自与显示同源的并集几何（§7.6），因此不重复计入已有槽体；界面单独列出该增量，并在并集几何不可用时退回单槽估算。

平面距离 `hypot(x2-x1,y2-y1)`；(0,0)到(3,4)为5m。用 `hypot` 求长度。计算结果必须有限，计算层使用完整精度，测试以绝对/相对误差比较，显示层才格式化。体积不是专业施工计价、安全放坡建议或松方/压实方换算；此项目只计算规定几何的原状开挖量。

## 10. 场景与交互生命周期

### 10.1 相机

自由视角：PerspectiveCamera，up=(0,0,1)，在创建 OrbitControls **之前**设置。俯视：OrthographicCamera 位于 +Z 看原点，up=(0,1,0)，禁用旋转，仅平移/缩放。前视：从 -Y 看向原点，up=(0,0,1)，+X 向右；侧视：从 +X 看原点，up=(0,0,1)，+Y 向右。前侧也用正交镜头。

切换保留观察目标并合理保持可视范围，不让相机 up 与视线平行；resize 按画布宽高比更新正交左右边界或透视 aspect。射线使用画布自身 `getBoundingClientRect()` 得到 NDC，不能按整个 window 归一化。绘制只允许俯视；与 z=0 无交点时忽略事件。

Three 默认 GridHelper 在 XZ 平面，需旋转到 XY。地面 PlaneGeometry 默认就在 XY，不要重复翻转。格线可使用极小正 z 偏移避免 z-fighting；开口内必须裁剪。

### 10.2 输入状态机

判别联合定义工具与各自的临时数据：`select | measure | drawTrench | placePit`（`DrawingManager`）。一个时刻只有一个主要工具。Esc 清理当前 draft、恢复 controls；切工具和开项目同样清理。绘制时禁用冲突的 Orbit 左键动作。**实现说明**：拖动编辑没有做成状态机分支，而是 `SceneViewport` 内的拖动草稿（`drag` ref：对象、节点序号、起始屏幕坐标、阈值标记），因为它只在 `select` 下生效且需要跨 pointermove 保留；状态机因此保持四个分支。

双击会伴随 click，不能把第二次点击重复加入节点；忽略 `event.detail>1` 的添加动作，并在提交前检测重复点。Enter 仅在非文本输入焦点且至少2点时提交；Esc 取消不进入历史。输入长度角度时 Enter 提交输入段，不同时完成整条槽。Ctrl+Z/Y、Delete 不拦截 input/textarea/contenteditable 内正常编辑。

拖动超过3 CSS像素才算拖动，pointer capture 配对释放；`pointercancel`/窗口失焦取消 draft。拖动时仅预览线，释放才提交完整几何且只生成一个撤销记录；非法终点恢复原位置。**M6 已落实**：`SceneManager.pickAt` 用射线拾取开挖实体（Mesh 的 `name` 即元素 id），俯视投影下按节点 2m 半径进入拖动，拖动中只更新预览线，pointerup 派发一次 `update`；选中对象同步高亮实体与中心线。撤销记录仍等 M8。

### 10.3 所有权和释放

React effect 创建 SceneManager，cleanup 调用 dispose；dispose 可重复调用。停止 requestAnimationFrame/animation loop，注销全部事件、ResizeObserver 和订阅，dispose controls、对象专属 Geometry/Material、renderer，并移除自建 canvas。

共享材质由拥有者管理，不在删除单一 Mesh 时释放。替换模型先准备成功后交换，失败释放新资源。使用 StrictMode 测试 mount→cleanup→mount；M1 检查无双 canvas、双动画循环和累积监听。M0 的 jsdom 测试不验证 WebGL。

## 11. 保存、历史与 Electron 接口

M8 实现 `FileGateway`：`open(): Promise<Result<OpenedFile | null>>`，`save(document, target?): Promise<Result<SaveOutcome>>`。打开的 null 表示用户取消。`SaveOutcome` 必须区分 `{ status: 'saved', file: SavedFile }`、`{ status: 'cancelled' }`、`{ status: 'export-requested' }`；外层 Result 的失败分支表示读写错误。renderer 不接受任意文件系统调用。

- 浏览器使用文件 input 读取和 Blob 下载作兼容后备；无文件句柄时“保存/另存为”是请求下载副本，UI 必须说明，不能声称覆盖原路径。Blob 下载无法确认用户是否取消或磁盘写入是否成功，只返回 export-requested；不得据此清 dirty、改变已保存基线或自动继续新建/打开。用户确认文件已导出后可通过独立“确认已导出”操作标记对应文档快照已保存；这属于用户确认，不伪装成文件系统成功回执。
- 支持 File System Access 的浏览器可选择原句柄保存；不能依赖该能力满足所有浏览器验收。
- JSON 先检查大小，再 parse 为 unknown，再逐字段白名单重建对象；检查 version/units/settings、IDs/限额、几何合法性。字段缺失按 v1 严格拒绝；真正迁移另设版本迁移函数。
- 保存失败/取消/仅请求下载不清 dirty；打开坏文件不替换当前项目；新建/打开/关闭前 dirty 确认提供 保存/放弃/取消。只有 status=saved 或用户明确确认导出完成才可继续原操作。保存和待确认期间禁止并发项目修改/打开动作，确认的必须是刚导出的文档快照，避免异步返回将后续编辑误标为已保存。浏览器 beforeunload 只能用浏览器原生提示，不能保证自定义三按钮。
- 历史最多50次已提交文档动作；输入打字和相机变换不入历史；拖动与一轮有效参数提交各一次。
- 保存点用完整文档内容/稳定序列化或可靠 revision 标记，不仅用历史栈长度；撤销回已保存内容应 clean，保存后再编辑为 dirty，重做分支在新动作后清除。

M10 才安装 Electron 和打包工具。使用 `contextIsolation:true`、`sandbox:true`、`nodeIntegration:false`；preload 只暴露特定 open/save 方法，通过 contextBridge；main 校验 IPC 发起来源、载荷及已授权目标。不能暴露裸 ipcRenderer、fs、eval、任意路径写入。

生产加载本地构建资源，阻止外部导航和新窗口，无本地 HTTP 服务依赖。沙盒 preload 优先编译成独立 `.cjs`，与 renderer ESM 构建分开验证。写文件采用同目录临时文件→刷新/关闭→重命名，失败保留原文件；保留同目录备份的策略在 M10 验证 Windows 文件占用情形。窗口关闭等待保存 Promise 后再关。

首发 Windows x64 Portable；Win10/11 各做干净用户环境验收（无 Node、无开发服务、断网、中文及空格路径）。Electron 的具体版本/最低 Windows 版本在 M10 按当时官方支持重新核实；M0 不宣称已经验证 Windows EXE。离线分发仍需考虑未签名程序系统提示，正式签名凭证不属于 M0。

## 12. 验证与交付门槛

所有里程碑共同门槛：

```powershell
npm ci                 # 新环境/锁文件改变时
npm run typecheck
npm run lint
npm test
npm run build
npm run smoke          # 同时验证 dev 和构建预览
git diff --check
```

`npm run check` 串行执行 typecheck、lint、test、build、smoke，任一失败必须停止并修复。服务默认仅绑定127.0.0.1；脚本的测试服务使用自动分配端口并在 finally 关闭，不占用用户已有端口。

M0：真实 DOM 首页测试、Three 包导入测试、dev/preview HTML 与 JS/CSS 资源检查、真实浏览器检查；不声称通过几何/GPU测试。

M1 起：真实浏览器 WebGL、resize、四种视角和清理；M2–4：参数→几何属性→法向/拓扑→实际显示；M7：解析数值和独立网格积分；M8：保存 round-trip 与失败不丢数据；M10：干净 Windows 离线运行。性能初始观察目标：100个简单对象/1000个槽节点，总体操作不卡死，拖动预览接近30fps；记录设备和样本，限额不是性能保证。

阶段报告必须列：完成内容、文件、设计、执行命令与结果、已知问题、下一阶段。验证通过后才提交；不要用 skip、test.only、关闭 strict 或降低断言来获得绿色结果。

## 13. 官方参考（2026-09-21 校核）

- [Vite 开始使用](https://vite.dev/guide/)：React TS 模板、开发与构建入口。Node 能力以实际锁定版本 engines 为准。
- [Vite base 配置](https://vite.dev/config/shared-options.html#base)：本地资源相对路径。
- [Vitest 入门](https://vitest.dev/guide/)：测试安装、运行和配置。
- [Three OrbitControls](https://threejs.org/docs/pages/OrbitControls.html)：控制器和相机 up 方向。
- [Three ShapeUtils](https://threejs.org/docs/pages/ShapeUtils.html)：带孔轮廓三角化 API。
- [React StrictMode](https://react.dev/reference/react/StrictMode)：开发期额外检查 effect 的创建和清理。
- [Electron Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)：隔离 preload 与页面，受限桥接。
- [Electron Process Sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox)：渲染进程沙盒与 IPC。
- [Electron ESM](https://www.electronjs.org/docs/latest/tutorial/esm)：主进程、renderer、preload 模块格式差异。

数学结论由本文定义直接推导；官方渲染 API 的可用性不等同于本项目几何正确性，仍必须用手册验收用例验证。
