import type { ReactElement } from 'react';
import { SceneViewport } from '../components/SceneViewport';

export function App(): ReactElement {
  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="brand-mark" aria-hidden="true">土</span>
        <div>
          <p className="eyebrow">EARTHWORK · 教学实验室</p>
          <h1>土方开挖教学模拟器</h1>
        </div>
        <span className="phase-badge">M1 · 基础三维场景</span>
      </header>

      <main>
        <SceneViewport />

        <aside className="next-stage" aria-labelledby="next-title">
          <p className="eyebrow">场地说明</p>
          <h2 id="next-title">平面与空间</h2>
          <p>地面位于 XY 平面，Z 轴向上。切换视角，观察同一场地的空间关系。</p>
          <p className="scope-note">前视、侧视与地面平行，平面呈一条线是正常现象；本阶段没有开挖对象。</p>
          <p className="scope-note">实体/线框将在有开挖对象后启用。绘制、计算和保存尚未实现。</p>
          <span className="pending-label">下一阶段 M2 · 参数化基坑</span>
        </aside>
      </main>

      <footer>
        <span>教学模拟 · 非专业工程计价</span>
        <span>米（m） · XY 平面 / Z 向上</span>
      </footer>
    </div>
  );
}
