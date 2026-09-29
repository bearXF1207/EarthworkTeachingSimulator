import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NumberFields } from '../src/components/PropertyPanel/NumberFields';
import type { NumberField } from '../src/components/PropertyPanel/NumberFields';
import { normalizeDegrees } from '../src/core/model/project';

const fields = (depth = 2): NumberField[] => [
  { key: 'depth', label: '深度', value: depth },
  { key: 'slope', label: '坡比', value: .5 },
];

describe('数值字段草稿与模型同步', () => {
  it.each(['', '-'])('无关重渲染保留临时文本 %j，外部模型变化才重置草稿和错误', text => {
    const apply = vi.fn(() => ({ ok: true as const, value: null }));
    const { rerender } = render(<NumberFields fields={fields()} apply={apply} />);
    const depth = screen.getByRole('textbox', { name: '深度' });
    fireEvent.change(depth, { target: { value: text } });
    rerender(<NumberFields fields={fields()} apply={apply} />);
    expect(depth).toHaveValue(text);
    expect(depth).toHaveAttribute('aria-invalid', 'true');
    expect(apply).not.toHaveBeenCalled();

    rerender(<NumberFields fields={fields(4)} apply={apply} />);
    expect(depth).toHaveValue('4');
    expect(depth).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: '坡比' }), { target: { value: '1' } });
    expect(apply).toHaveBeenLastCalledWith({ depth: 4, slope: 1 });
  });

  it('被拒绝的数值保留错误，外部更新后提交采用新的模型值', () => {
    const apply = vi.fn(() => ({ ok: false as const, issues: [
      { code: 'invalid', path: 'depth', message: '深度必须大于零' },
    ] }));
    const { rerender } = render(<NumberFields fields={fields()} apply={apply} />);
    const depth = screen.getByRole('textbox', { name: '深度' });
    fireEvent.change(depth, { target: { value: '0' } });
    rerender(<NumberFields fields={fields()} apply={apply} />);
    expect(depth).toHaveValue('0');
    expect(screen.getByRole('alert')).toHaveTextContent('深度必须大于零');

    rerender(<NumberFields fields={fields(5)} apply={apply} />);
    expect(depth).toHaveValue('5');
    expect(depth).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(apply).toHaveBeenCalledTimes(1); // 同步模型不产生新的编辑。
    fireEvent.change(screen.getByRole('textbox', { name: '坡比' }), { target: { value: '1' } });
    expect(apply).toHaveBeenLastCalledWith({ depth: 5, slope: 1 });
  });

  it('自己的成功提交保留小数输入、输入节点和焦点', () => {
    const applied = vi.fn();
    function Editor() {
      const [depth, setDepth] = useState(2);
      return <NumberFields fields={fields(depth)} apply={values => {
        applied(values); setDepth(values.depth!);
        return { ok: true, value: null };
      }} />;
    }
    const { rerender } = render(<Editor />);
    const depth = screen.getByRole('textbox', { name: '深度' }) as HTMLInputElement;
    depth.focus();
    fireEvent.change(depth, { target: { value: '3.' } });
    expect(depth).toHaveValue('3.');
    expect(applied).toHaveBeenLastCalledWith({ depth: 3, slope: .5 });
    depth.setSelectionRange(1, 1);
    rerender(<Editor />);
    expect(screen.getByRole('textbox', { name: '深度' })).toBe(depth);
    expect(depth).toHaveFocus();
    expect(depth.selectionStart).toBe(1);
    fireEvent.change(depth, { target: { value: '3.5' } });
    expect(depth).toHaveValue('3.5');
    expect(applied).toHaveBeenLastCalledWith({ depth: 3.5, slope: .5 });
  });

  it.each([0, 10])('接受旋转归一化后的值，包含归一化回原值 %i 的情况', initial => {
    function Editor() {
      const [rotation, setRotation] = useState(initial);
      return <NumberFields fields={[{ key: 'rotation', label: '旋转角', value: rotation }]} apply={values => {
        setRotation(normalizeDegrees(values.rotation!));
        return { ok: true, value: null };
      }} />;
    }
    render(<Editor />);
    const rotation = screen.getByRole('textbox', { name: '旋转角' });
    fireEvent.change(rotation, { target: { value: '370' } });
    expect(rotation).toHaveValue('10');
  });
});
