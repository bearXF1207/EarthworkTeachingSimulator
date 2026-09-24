import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { failed: boolean };

/**
 * 最小错误边界：渲染期异常时给出可读提示与重试入口，而不是整页白屏。
 * 工程数据只存在内存（保存属 M8），重试会重新挂载界面，浏览器刷新同样会清空工程。
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State { return { failed: true }; }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('界面渲染失败：', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return <div className="fatal-error" role="alert">
      <p>界面渲染出错，已停止本次渲染。当前工程只存在内存中，刷新或重试都会重新开始。</p>
      <button onClick={() => this.setState({ failed: false })}>重试渲染</button>
    </div>;
  }
}
