# 土方开挖教学模拟器 V2

## 可执行开发任务书

---

# 1. 项目定位

开发一个运行于 Windows 的轻量级、完全离线的土方开挖教学模拟软件。
软件主要面向教学演示，而不是专业 BIM、CAD 或工程计价。
核心目标：
**用户在平面场地上绘制基槽或放置基坑 → 输入施工参数 → 软件自动生成三维开挖效果 → 自动估算土方量。**

软件整体交互风格应更加接近：

**施工模拟游戏 / 建造模拟软件**

而不是传统 CAD。

---

# 2. 最终运行形式

最终软件打包为 Windows 桌面程序。

例如：

```text
土方开挖教学模拟器.exe
```

要求：

* Windows 10 / Windows 11 可运行；
* 不需要联网；
* 不需要登录；
* 不需要服务器；
* 不需要数据库；
* 不需要安装 Unreal Engine；
* 最终用户无需安装 Node.js；
* 所有项目数据保存在本地。

开发阶段允许使用浏览器调试。

最终通过 Electron 打包成独立程序。

---

# 3. 技术路线

采用：

```text
Electron
+
React
+
TypeScript
+
Three.js
+
Vite
```

职责划分：

```text
Electron
负责 Windows 桌面程序、文件系统、打开/保存项目、EXE 打包

React
负责界面、菜单、属性面板、工具栏、弹窗

TypeScript
负责项目数据、计算逻辑、业务逻辑、几何参数

Three.js
负责三维场景、摄像机、地面、基坑、基槽、辅助线

Vite
负责开发环境和构建
```

开发阶段优先：

```text
React + TypeScript + Three.js
```

先在浏览器中完成功能。

核心功能稳定以后再接入：

```text
Electron
```

---

# 4. 开发原则

必须遵守：

1. TypeScript 开启 strict。
2. 几何算法与 React UI 分离。
3. 项目数据与 Three.js Mesh 分离。
4. 所有工程内部尺寸统一使用米。
5. Three.js 对象不得直接写入项目保存文件。
6. 用户修改参数后重新生成 Mesh。
7. 所有 Geometry、Material 等资源需要正确释放。
8. 所有输入参数必须验证。
9. 不允许产生 NaN / Infinity。
10. 项目文件必须包含 version。
11. 每完成一个开发阶段必须执行 TypeScript 检查和 build。
12. 功能优先于视觉效果。
13. 第一版禁止为了视觉效果引入过重系统。
14. 所有核心功能必须能够完全离线使用。

---

# 5. 软件主要操作逻辑

软件主视图以 Three.js 三维施工场地为核心。

不建立完全独立的 CAD 2D 编辑器。

通过摄像机模式实现：

```text
自由视角
俯视图
前视图
侧视图
```

其中：

```text
俯视图
```

承担主要平面绘制功能。

用户可以：

```text
俯视绘制
↓
输入参数
↓
切换自由视角
↓
观察三维开挖效果
```

---

# 6. 软件主界面

建议布局：

```text
┌────────────────────────────────────────────────────────────┐
│ 土方开挖教学模拟器         新建  打开  保存  撤销  重做    │
├──────────┬───────────────────────────────────┬─────────────┤
│          │                                   │             │
│施工工具  │                                   │ 参数面板    │
│          │                                   │             │
│选择      │                                   │ 类型        │
│基槽      │            三维施工场地           │ 尺寸        │
│基坑      │                                   │ 深度        │
│测量      │                                   │ 坡比        │
│删除      │                                   │             │
│          │                                   │ 计算结果    │
│          │                                   │ 土方量      │
│          │                                   │             │
├──────────┴───────────────────────────────────┴─────────────┤
│ 自由视角 | 俯视 | 前视 | 侧视 | 网格 | 实体 | 线框        │
└────────────────────────────────────────────────────────────┘
```

界面风格：

* 深色或中性界面；
* 三维场地占据主要屏幕；
* 左侧为建造工具；
* 右侧为参数属性；
* 按钮尺寸偏大；
* 操作逻辑简单；
* 避免 CAD 式密集工具栏。

---

# 7. 软件核心对象

第一版支持两大类对象：

```text
Trench
基槽

Pit
基坑
```

---

# 8. 基槽定义

基槽由中心线定义。

中心线允许：

```text
直线
折线
```

例如：

```text
P1 ───────── P2
```

或者：

```text
P1 ───── P2
           \
            \
             P3 ───── P4
```

禁止：

```text
圆弧
贝塞尔曲线
样条曲线
自由曲线
```

因此整个基槽只由若干：

```text
Straight Line Segment
```

组成。

---

# 9. 基槽绘制模式

进入：

```text
创建基槽
```

后进入绘制状态。

### 鼠标绘制

第一次点击：

```text
P1
```

确定起点。

继续点击：

```text
P2
P3
P4
```

生成连续折线。

双击或按 Enter：

```text
结束绘制
```

按 Esc：

```text
取消当前绘制
```

---

# 10. 基槽精确输入

除了鼠标绘制外，需要支持精确输入。

用户点击起点之后，可输入：

```text
长度
角度
```

例如：

```text
长度：12.5m
角度：30°
```

生成下一节点。

然后可以继续输入：

```text
长度：8m
角度：90°
```

形成下一段。

角度统一约定。

建议：

```text
0° = X轴正方向
90° = Y轴正方向
```

逆时针为正。

---

# 11. 基槽绘制实时提示

鼠标移动过程中显示：

```text
长度：8.52m

角度：32.6°
```

建议在鼠标附近显示浮动辅助框。

同时显示预览线：

```text
P1 ●────────────○ 鼠标
```

---

# 12. 基槽参数

每一个完整基槽拥有：

```text
底宽 Bottom Width

开挖深度 Depth

放坡系数 Slope
```

第一版同一条基槽所有段使用相同参数。

例如：

```text
底宽：2.0m

深度：1.5m

放坡系数：0.5
```

暂时不支持：

```text
不同段不同深度
不同段不同底宽
不同段不同坡比
```

以后可以扩展。

---

# 13. 放坡系数定义

统一采用：

```text
Slope = 水平距离 / 垂直距离
```

设：

```text
底宽 = B

深度 = H

坡比系数 = m
```

则：

```text
单侧水平放坡距离：

D = H × m
```

顶部宽度：

```text
T = B + 2Hm
```

例如：

```text
B = 2m
H = 2m
m = 0.5
```

则：

```text
D = 1m

T = 4m
```

---

# 14. 基槽截面

基槽采用梯形截面：

```text
Top Width

    ─────────────
     \          /
      \        /
       ───────
      Bottom Width

          H
```

地面：

```text
Z = 0
```

槽底：

```text
Z = -Depth
```

---

# 15. 基槽三维生成

Geometry Engine 输入：

```text
centerline points[]

bottomWidth

depth

slope
```

输出：

```text
THREE.BufferGeometry
```

基础步骤：

```text
中心线
↓
计算每一段方向
↓
计算法向
↓
计算槽底左右边界
↓
计算顶部左右边界
↓
处理折线节点
↓
生成槽底
↓
生成左右边坡
↓
生成起点端面
↓
生成终点端面
↓
生成BufferGeometry
```

---

# 16. 基槽折线转角

由于基槽允许折线，因此 Geometry Engine 必须正确处理转角。

例如：

```text
─────────┐
         │
         │
```

第一版推荐使用：

```text
Miter Join
```

或在算法不稳定时使用：

```text
Bevel Join
```

要求：

* 转角处不能明显断开；
* 不能出现大面积重叠面；
* 不能生成 NaN；
* 不能因为接近 180° 或极小角度而崩溃。

对于过于尖锐的角度，应设置限制。

例如：

```text
最小夹角建议 ≥ 10°
```

低于限制时：

```text
禁止创建
或
自动采用 Bevel
```

---

# 17. 基槽自相交

MVP 阶段：

**禁止基槽中心线自相交。**

例如：

```text
\    /
 \  /
  \/
  /\
 /  \
```

属于非法基槽。

创建完成时需要检测。

如果出现：

```text
中心线自相交
```

提示：

```text
当前基槽存在自相交，请调整节点。
```

---

# 18. 基坑类型

点击：

```text
创建基坑
```

之后选择：

```text
方形

矩形

圆形
```

三种第一版全部实现。

---

# 19. 方形基坑参数

参数：

```text
底边长

深度

放坡系数
```

例如：

```text
底边长 = 4m

深度 = 2m

坡比 = 0.5
```

顶部尺寸：

```text
6m × 6m
```

---

# 20. 矩形基坑参数

参数：

```text
底长

底宽

深度

放坡系数
```

顶部：

```text
TopLength
=
BottomLength + 2 × Depth × Slope

TopWidth
=
BottomWidth + 2 × Depth × Slope
```

---

# 21. 圆形基坑参数

参数：

```text
底部直径

深度

放坡系数
```

计算：

```text
BottomRadius = BottomDiameter / 2

TopRadius
=
BottomRadius + Depth × Slope
```

---

# 22. 基坑放置

选择基坑类型之后：

鼠标点击地面：

```text
●
```

作为基坑中心。

模型立即生成。

之后在右侧属性面板修改参数。

参数修改：

```text
立即更新三维模型
```

---

# 23. 基坑旋转

方形、矩形基坑增加：

```text
旋转角度 Rotation
```

默认：

```text
0°
```

可以：

* 输入角度；
* 后期增加旋转操纵杆。

圆形基坑无需旋转。

---

# 24. 基坑位置

右侧属性允许显示：

```text
X

Y
```

第一版可以允许：

```text
鼠标拖动
```

改变位置。

也可以直接输入坐标。

---

# 25. 三维施工场地

Three.js 场景包括：

```text
Scene

Ground

Grid

Excavation Objects

Camera

Lights

Selection Helper

Dimension Helpers
```

---

# 26. 地面

第一版使用水平施工场地：

```text
Z = 0
```

无需真实地形。

默认尺寸例如：

```text
100m × 100m
```

场地也可以根据项目范围动态扩展。

---

# 27. 地面视觉

建议：

```text
浅棕 / 灰绿色施工场地

开挖边坡采用土黄色或棕色

槽底略深

网格使用低对比度显示
```

不要追求写实。

目标：

```text
清楚
直观
教学友好
```

---

# 28. MVP 地面开挖表现

第一阶段无需复杂布尔运算。

推荐实现：

```text
完整地面
+
开挖坑槽模型
```

可以通过：

```text
局部遮罩
半透明
颜色区分
```

表现开挖。

如果实现成本可接受，则第二阶段再做真正：

```text
Ground Hole / CSG
```

第一版不要让布尔运算阻塞项目。

---

# 29. 摄像机

提供四个按钮：

```text
自由视角

俯视

前视

侧视
```

---

# 30. 自由视角

采用：

```text
PerspectiveCamera
+
OrbitControls
```

操作：

```text
旋转

平移

滚轮缩放
```

---

# 31. 俯视模式

俯视模式主要承担绘图。

建议使用：

```text
OrthographicCamera
```

而不是 PerspectiveCamera。

这样绘制尺寸更稳定。

俯视：

```text
Z轴向下看
```

表现类似施工平面图。

---

# 32. 绘图网格

场地显示网格。

默认：

```text
1m
```

后续可以设置：

```text
0.1m

0.5m

1m

5m
```

第一版至少：

```text
1m
```

---

# 33. 网格吸附

第一版支持：

```text
开启

关闭
```

吸附间距：

```text
1m
```

绘制节点和基坑中心均可吸附。

后期再增加：

```text
端点吸附
水平吸附
垂直吸附
```

---

# 34. 选择系统

用户点击：

```text
基坑

或

基槽
```

选中对象。

选中后：

* 模型高亮；
* 右侧显示参数；
* 显示删除按钮；
* 基槽显示控制节点。

---

# 35. 基槽节点编辑

选中基槽后显示：

```text
●────●
      \
       ●────●
```

节点可拖动。

节点移动过程中：

```text
实时刷新中心线
```

拖动结束后：

```text
重新生成完整3D模型
```

为避免性能问题：

拖动过程中可以只显示预览线。

释放鼠标后重新计算 Mesh。

---

# 36. 节点增删

MVP 至少支持：

```text
移动节点

删除整个基槽
```

第二阶段增加：

```text
插入节点

删除单个节点
```

如果实现简单，也可以提前加入。

---

# 37. 参数实时更新

用户修改：

```text
底宽
深度
坡比
长度
位置
旋转
```

之后：

```text
Project Data 更新
↓
Geometry Engine 重建
↓
Scene Renderer 刷新
```

---

# 38. 土方量计算

精度要求：

```text
教学级
近似计算
```

无需专业计价级精度。

---

# 39. 基槽土方量

对于没有折点的单段基槽：

```text
顶部宽 T = B + 2Hm
```

断面面积：

```text
A = (B + T) / 2 × H
```

体积：

```text
V = A × L
```

---

# 40. 折线基槽土方量

由于同一条基槽截面参数一致，可以使用：

```text
总中心线长度
×
梯形截面面积
```

即：

```text
Ltotal
=
Σ 每段长度
```

然后：

```text
V ≈ A × Ltotal
```

第一版无需精确计算折角位置的重叠体积。

界面可标记：

```text
预计土方量
```

而不是：

```text
精确土方量
```

---

# 41. 方形/矩形基坑土方量

使用棱台公式。

设：

```text
底面积 = A1

顶面积 = A2

深度 = H
```

体积：

```text
V =
H / 3
×
(A1 + A2 + √(A1 × A2))
```

用于：

```text
方形基坑

矩形基坑
```

---

# 42. 圆形基坑土方量

使用圆台公式。

设：

```text
底半径 = r

顶半径 = R

深度 = H
```

则：

```text
V =
πH / 3
×
(R² + Rr + r²)
```

---

# 43. 参数结果显示

选中基槽时：

```text
类型
基槽

总长度
25.60m

底宽
2.00m

深度
1.50m

坡比
0.50

顶部宽度
3.50m

预计土方量
105.60m³
```

选中基坑时类似。

---

# 44. 测量工具

第一版加入简单距离测量。

点击：

```text
测量
```

选择两个地面点。

显示：

```text
距离：8.52m
```

第二阶段再增加：

```text
角度测量

高差
```

---

# 45. 项目数据结构

所有项目状态存储于：

```text
Project
```

建议：

```typescript
interface Project {
  version: number;
  name: string;
  units: "m";
  elements: ExcavationElement[];
  settings: ProjectSettings;
}
```

---

# 46. ExcavationElement

建议：

```typescript
type ExcavationElement =
  | TrenchElement
  | RectPitElement
  | SquarePitElement
  | CircularPitElement;
```

---

# 47. Trench 数据结构

建议：

```typescript
interface TrenchElement {
  id: string;
  type: "trench";

  points: {
    x: number;
    y: number;
  }[];

  bottomWidth: number;
  depth: number;
  slope: number;
}
```

---

# 48. 方形基坑

```typescript
interface SquarePitElement {
  id: string;
  type: "square-pit";

  position: {
    x: number;
    y: number;
  };

  bottomSize: number;

  depth: number;
  slope: number;

  rotation: number;
}
```

---

# 49. 矩形基坑

```typescript
interface RectPitElement {
  id: string;
  type: "rect-pit";

  position: {
    x: number;
    y: number;
  };

  bottomLength: number;
  bottomWidth: number;

  depth: number;
  slope: number;

  rotation: number;
}
```

---

# 50. 圆形基坑

```typescript
interface CircularPitElement {
  id: string;
  type: "circular-pit";

  position: {
    x: number;
    y: number;
  };

  bottomDiameter: number;

  depth: number;
  slope: number;
}
```

---

# 51. 项目保存

项目使用 JSON。

扩展名可自定义为：

```text
.excavation
```

例如：

```text
教学案例01.excavation
```

内部：

```json
{
  "version": 1,
  "name": "教学案例01",
  "units": "m",
  "elements": []
}
```

---

# 52. 文件功能

必须实现：

```text
新建

打开

保存

另存为
```

关闭存在未保存修改的工程时：

```text
提示保存
```

---

# 53. Undo / Redo

实现：

```text
撤销 Ctrl + Z

重做 Ctrl + Y
```

至少支持：

```text
创建对象

删除对象

修改参数

移动基坑

移动基槽节点
```

历史记录：

```text
50步
```

即可。

---

# 54. 项目目录

推荐：

```text
excavation-simulator/

src/

  app/

  components/

    TopBar/

    ToolPanel/

    PropertyPanel/

    ViewControls/

    dialogs/

  core/

    model/

      project.ts

      trench.ts

      pit.ts

    geometry/

      trenchGenerator.ts

      squarePitGenerator.ts

      rectPitGenerator.ts

      circularPitGenerator.ts

      polylineOffset.ts

      joinSolver.ts

    calculation/

      trenchVolume.ts

      pitVolume.ts

      measurement.ts

    validation/

      trenchValidation.ts

      parameterValidation.ts

    commands/

      commandManager.ts

    io/

      projectSerializer.ts

  scene/

    SceneManager.ts

    CameraManager.ts

    GroundManager.ts

    SelectionManager.ts

    DrawingManager.ts

    MeshFactory.ts

  store/

    projectStore.ts

electron/

  main.ts

  preload.ts

tests/
```

---

# 55. 不允许出现的架构问题

禁止：

```text
App.tsx 里面写几千行代码
```

禁止：

```text
React组件直接负责复杂Geometry生成
```

禁止：

```text
Mesh本身作为工程数据
```

禁止：

```text
不同模块直接修改Three.js Scene
```

应通过：

```text
SceneManager
```

统一管理。

---

# 56. 开发阶段总览

整个项目分：

```text
M0
环境与项目初始化

M1
基础3D场景

M2
基坑参数化

M3
直线基槽

M4
折线基槽

M5
俯视绘制系统

M6
对象选择与编辑

M7
土方量与测量

M8
保存、撤销、工程系统

M9
界面与教学体验

M10
Electron与Windows打包
```

---

# 57. M0——环境初始化

目标：

建立可以正常开发的 React + TypeScript + Three.js 项目。

任务：

```text
创建Vite项目

配置React

配置TypeScript strict

安装Three.js

建立目录结构

配置ESLint

配置基础测试环境
```

暂时不要 Electron。

验收：

```text
npm run dev
```

可以运行。

```text
npm run build
```

无错误。

---

# 58. M1——基础三维场景

任务：

创建：

```text
Scene

Camera

Renderer

Ground

Grid

Lights

OrbitControls
```

实现：

```text
自由视角

俯视视角

重置镜头
```

验收：

浏览器中能够看到：

```text
施工场地
+
网格
```

可以：

```text
旋转
缩放
平移
```

---

# 59. M2——基坑

开发顺序：

```text
M2.1 方形基坑

M2.2 矩形基坑

M2.3 圆形基坑
```

每一种都必须：

```text
参数 → Geometry
```

实时更新。

验收案例：

方形：

```text
底边：4m

深度：2m

坡比：0.5
```

要求：

```text
顶部边长 = 6m
```

---

# 60. M3——直线基槽

暂时只支持：

```text
P1 → P2
```

实现：

```text
中心线
底部
边坡
端面
```

验收：

```text
长度 = 20m

底宽 = 2m

深度 = 2m

坡比 = 0.5
```

顶部宽度必须：

```text
4m
```

---

# 61. M4——折线基槽

扩展：

```text
P1
P2
P3
P4
...
```

实现：

```text
折线offset

转角join

连续槽底

连续边坡
```

优先解决：

```text
90°转角
45°转角
钝角转角
```

---

# 62. M4验收案例

案例一：

```text
P1(0,0)

P2(10,0)

P3(10,10)
```

即：

```text
L型
```

要求：

* 模型连续；
* 无明显裂缝；
* 无巨大尖刺；
* 无崩溃。

案例二：

```text
P1(0,0)

P2(10,0)

P3(15,5)

P4(25,5)
```

要求正常。

---

# 63. M5——俯视绘制

进入俯视图。

支持：

```text
绘制基槽

放置基坑
```

基槽：

```text
单击添加节点

双击或Enter结束

Esc取消
```

鼠标移动实时显示：

```text
长度

角度
```

---

# 64. M5精确绘制

在绘制过程中允许：

```text
输入长度

输入角度
```

生成下一点。

例如：

```text
Length = 8

Angle = 90
```

从当前节点生成下一节点。

---

# 65. M6——选择编辑

实现：

```text
Raycasting选择
```

选中对象：

```text
高亮
```

右侧属性面板：

```text
同步显示参数
```

修改参数：

```text
立即更新模型
```

---

# 66. M6基槽控制点

选择基槽以后显示节点。

支持：

```text
鼠标拖动节点
```

完成之后：

```text
重新生成Geometry
```

---

# 67. M7——计算系统

实现：

```text
基槽总长度

顶部宽度

预计土方量

方形基坑土方量

矩形基坑土方量

圆形基坑土方量
```

所有计算写在：

```text
core/calculation/
```

不要写在 UI。

---

# 68. M7——测量

实现：

```text
两点距离
```

结果：

```text
8.52m
```

---

# 69. M8——工程系统

实现：

```text
Project Store

项目修改状态

新建

保存

打开

另存为

Undo

Redo
```

保存后退出重新打开：

所有对象应完全恢复。

---

# 70. M9——界面优化

功能稳定后才做。

优化：

```text
工具按钮

参数输入

图标

选中效果

状态栏

错误提示

视角切换动画
```

整体偏施工模拟游戏风格。

不要过度动画化。

---

# 71. M10——Electron

在网页版本功能全部通过验收后：

接入：

```text
Electron
```

实现：

```text
桌面窗口

原生打开文件

原生保存文件

窗口关闭提示

Windows构建
```

---

# 72. Windows打包

生成：

```text
Installer
```

或者：

```text
Portable EXE
```

第一版优先：

```text
Portable版本
```

方便教学电脑直接使用。

---

# 73. 必须测试的异常情况

包括：

```text
底宽 = 0

深度 = 0

负数

坡比负数

两个基槽节点完全重合

连续重复节点

极小长度

接近180°折返

基槽自相交

非常大的参数

删除当前选中对象
```

软件不能崩溃。

---

# 74. 参数限制

建议第一版：

```text
底宽 > 0

深度 > 0

坡比 >= 0

长度 > 0.01m
```

角度：

```text
0° ～ 360°
```

内部统一正规化。

---

# 75. MVP完成标准

以下全部完成，才视为 MVP：

```text
✓ Windows独立运行

✓ 完全离线

✓ 3D施工场地

✓ 自由视角

✓ 俯视绘制

✓ 方形基坑

✓ 矩形基坑

✓ 圆形基坑

✓ 直线基槽

✓ 折线基槽

✓ 不支持曲线

✓ 底宽参数

✓ 深度参数

✓ 放坡参数

✓ 长度/角度输入

✓ 基槽节点编辑

✓ 基坑位置编辑

✓ 参数实时更新

✓ 预计土方量

✓ 距离测量

✓ 新建

✓ 保存

✓ 打开

✓ 撤销

✓ 重做
```

---

# 76. MVP明确不做

第一版禁止主动添加：

```text
CAD导入

DXF

BIM

Revit

GIS

真实地形

复杂支护

地下水

真实机械

挖掘机动画

人物

多人联机

账号

云端

服务器

数据库

AI助手

在线素材

复杂物理

UE5

高精度工程量
```

---

# 77. 第二阶段候选功能

MVP完成以后再考虑：

```text
基槽不同段设置不同参数

单独删除/增加基槽节点

尺寸标注

角度标注

断面视图

工作面宽度

分级放坡

开挖平台

施工阶段模拟

挖掘机动画

分层开挖

截图导出

教学案例模板
```

---

# 78. 推荐后期的施工模拟功能

如果后期希望更像游戏，可以加入：

```text
施工阶段
```

例如：

```text
场地原状
↓
放线
↓
开挖25%
↓
开挖50%
↓
开挖100%
```

通过：

```text
进度滑块
```

观看。

但不属于 MVP。

---

# 79. 执行规则

不得一次性尝试完成整个项目。

必须：

```text
完成一个Milestone
↓
运行
↓
测试
↓
修复
↓
build
↓
提交阶段结果
↓
再进入下一Milestone
```

---

# 80. 每阶段必须报告

每一个 Milestone 完成后输出：

```text
1. 本阶段完成内容

2. 新增/修改文件

3. 核心设计说明

4. 已运行测试

5. 已知问题

6. 下一阶段准备
```

---

# 81. 禁止行为

禁止：

```text
为了快速实现把所有逻辑塞进一个文件

绕过TypeScript类型检查

大量使用any

忽略build错误

修改需求范围

主动添加服务器

主动添加数据库

主动加入UE5

在几何错误情况下继续开发UI
```

---

# 82. 开发优先级

始终遵循：

```text
几何正确
>
数据正确
>
交互可用
>
工程保存
>
视觉美观
```

不得倒置。

---

# 83. 第一条总指令

你现在要开发一个名为“土方开挖教学模拟器”的 Windows 本地软件。

项目采用：

React + TypeScript + Three.js。

核心功能稳定以后再接入 Electron。

这是一个教学用施工模拟软件，不是 CAD，也不是 BIM 软件。

用户可以在俯视场地中：

1. 绘制由多段直线组成的折线基槽；
2. 基槽允许折线，但禁止任何圆弧、样条或曲线；
3. 创建方形、矩形、圆形基坑；
4. 设置底部尺寸、开挖深度和放坡系数；
5. 查看自动生成的三维开挖效果；
6. 自动计算预计土方量；
7. 编辑参数与基槽节点；
8. 保存和重新打开工程。

软件完全本地运行。

技术原则：

* TypeScript strict；
* 数据层与Three.js Mesh分离；
* UI与Geometry Engine分离；
* 所有内部单位使用米；
* Geometry Engine独立模块化；
* 不允许大量使用any；
* 不允许把业务逻辑堆入React组件；
* 每完成阶段必须执行类型检查、测试和build；
* 如果当前阶段存在错误，不得继续下一阶段。

现在只执行：

M0 —— 项目初始化。

不要提前开发后续功能。

M0任务：

1. 使用Vite创建React + TypeScript项目；
2. 安装并配置Three.js；
3. 开启TypeScript strict；
4. 建立任务书约定的目录结构；
5. 配置基础代码质量检查；
6. 创建最小首页；
7. 确保开发服务器正常；
8. 确保production build正常。

完成以后报告：

* 创建了哪些文件；
* 安装了哪些依赖；
* 项目目录结构；
* build结果；
* 当前是否存在错误。

不要进入M1，等待下一条指令。

---

# 84. 后续工作方式

例如：

```text
现在执行 M1。
严格按照任务书完成基础三维施工场地。
不要提前执行 M2。
```

完成 M1 并确认效果以后，再发送：

```text
现在执行 M2.1。
实现方形参数化基坑。
```

不要把：

```text
M0 ～ M10
```

# 85. 最终项目目标

最终软件启动后，典型教学流程：

```text
启动软件
↓
新建工程
↓
切换俯视图
↓
选择“基槽”
↓
绘制折线
↓
输入底宽、深度、坡比
↓
自动生成3D基槽
↓
查看预计土方量
↓
选择“矩形基坑”
↓
在场地放置
↓
修改参数
↓
切换自由视角
↓
观察整体开挖效果
↓
保存教学工程
```

项目的核心价值不是高精度建模，而是：

**让学生直观理解“平面布置、开挖尺寸、放坡参数、三维形态和土方量”之间的关系。**


