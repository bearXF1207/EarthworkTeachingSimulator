import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/app/App';

describe('M0 首页', () => {
  it('渲染应用名称和基础环境，证明 React 入口组件可挂载', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: '土方开挖教学模拟器' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '项目基础环境已就绪' })).toBeVisible();
    expect(screen.getByText(/Three\.js r\d+ 已接入/)).toBeVisible();
  });

  it('明确当前里程碑与未实现范围，避免把 M0 当作可用的模拟功能', () => {
    render(<App />);
    expect(screen.getByText('M0 · 环境初始化')).toBeVisible();
    expect(screen.getByText(/三维场地、绘制、计算和工程保存将在后续里程碑实现/)).toBeVisible();
    expect(screen.getByText('等待执行 M1')).toBeVisible();
    expect(screen.getByText('教学模拟 · 非专业工程计价')).toBeVisible();
  });
});
