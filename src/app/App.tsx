import type { ReactElement } from 'react';
import { threeRevision } from '../scene/runtimeInfo';

export function App(): ReactElement {
  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="brand-mark" aria-hidden="true">土</span>
        <div>
          <p className="eyebrow">EARTHWORK · 教学实验室</p>
          <h1>土方开挖教学模拟器</h1>
        </div>
        <span className="phase-badge">M0 · 环境初始化</span>
      </header>

      <main>
        <section className="welcome" aria-labelledby="welcome-title">
          <p className="eyebrow">从平面布置，理解三维开挖</p>
          <h2 id="welcome-title">项目基础环境已就绪</h2>
          <p className="intro">
            这里将用于绘制基槽、放置基坑，并观察尺寸与放坡参数对开挖形态和预计土方量的影响。
          </p>
          <p className="scope-note">
            当前完成 M0 项目初始化。三维场地、绘制、计算和工程保存将在后续里程碑实现。
          </p>
          <dl className="environment-list" aria-label="基础环境">
            <div><dt>界面与数据</dt><dd>React + TypeScript strict</dd></div>
            <div><dt>三维依赖</dt><dd>Three.js r{threeRevision} 已接入</dd></div>
            <div><dt>运行资源</dt><dd>本地资源 · 无在线素材</dd></div>
          </dl>
        </section>

        <aside className="next-stage" aria-labelledby="next-title">
          <span className="step-number" aria-hidden="true">01</span>
          <p className="eyebrow">下一里程碑</p>
          <h2 id="next-title">基础三维场地</h2>
          <p>地面与网格、摄像机、光照，以及视角切换和场景资源管理。</p>
          <span className="pending-label">等待执行 M1</span>
        </aside>
      </main>

      <footer>
        <span>教学模拟 · 非专业工程计价</span>
        <span>米（m） · XY 平面 / Z 向上</span>
      </footer>
    </div>
  );
}
