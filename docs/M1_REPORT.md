# M1 完成报告

2026-09-22：基础三维场景已完成。

- 100m×100m XY 地面、1m网格、光照及XYZ参考轴。
- 自由/俯视/前视/侧视，切换保留目标及尺度；重置当前镜头；鼠标旋转、平移和缩放。
- 显示网格开关；实体/线框设置接口已建立，M1没有开挖对象，控件禁用并说明原因。
- SceneManager统一拥有场景；释放renderer、Geometry、Material、OrbitControls、ResizeObserver、监听器和动画循环，dispose幂等。
- 支持WebGL初始化错误提示、上下文丢失/恢复和重新加载场景。

新增 CameraManager、GroundManager、SceneManager、SceneViewport、ViewControls；修改首页与样式；新增相机、地面、生命周期测试及GPU测试替身。数据与Three对象仍分离，没有提前实现基坑。

## 验证

`npm run check`通过：类型检查、ESLint、4个文件16项测试、production build、dev/preview HTTP资源检查。

测试覆盖四视角方向、正交比例、重置、容器resize、网格坐标、资源幂等释放、StrictMode挂载、10次重载、上下文恢复，以及真实OrbitControls左键旋转/右键平移/正交拖动事件。

真实浏览器：地面与网格可见；俯视平移/滚轮缩放有效；四视角和重置各循环5次；10次重新加载始终一个canvas，控制台无warn/error。前/侧视的地面呈水平线符合零厚度平面模型。GPU显存没有独立硬件计量，资源释放由调用与生命周期测试验证，不宣称已完成性能基准。

构建无错误；包含Three渲染器的JS约783KB，gzip约209KB，Vite报告超过500KB的体积提示。本地离线应用可以使用，未提高阈值隐藏警告。

下一阶段为M2三类参数化基坑及地面孔洞。官方API依据：[OrbitControls](https://threejs.org/docs/pages/OrbitControls.html)、[WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)。
