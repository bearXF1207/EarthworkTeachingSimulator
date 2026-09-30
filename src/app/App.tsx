import type { ReactElement } from 'react';
import { SceneViewport } from '../components/SceneViewport';
import { ErrorBoundary } from './ErrorBoundary';

export function App(): ReactElement {
  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="brand-mark" aria-hidden="true">土</span>
        <div>
          <p className="eyebrow">EARTHWORK · 教学实验室</p>
          <h1>土方开挖教学模拟器</h1>
        </div>
        <span className="phase-badge">开发者：熊峰</span>
      </header>

      <main className="workspace">
        <ErrorBoundary>
          <SceneViewport />
        </ErrorBoundary>
      </main>

      <footer>
        <span>教学模拟 · 非专业工程计价</span>
        <span>米（m） · XY 平面 / Z 向上</span>
      </footer>
    </div>
  );
}
