import type { ReactElement } from 'react';

export type UnsavedChoice = 'save' | 'discard' | 'cancel';

type Props = {
  action: 'new' | 'open';
  /** 上一次选择保存后的结果说明（取消、失败、仅请求导出）。 */
  message: string;
  busy: boolean;
  gatewayKind: 'file-system' | 'download';
  onChoose: (choice: UnsavedChoice) => void;
};

/**
 * M8 未保存确认：保存 / 不保存 / 取消。
 * 只有真正写入成功（或用户随后确认已导出）才会继续原动作；
 * 保存取消或失败都停留在本对话框，不会丢失工程。
 */
export function UnsavedDialog({ action, message, busy, gatewayKind, onChoose }: Props): ReactElement {
  const target = action === 'new' ? '新建工程' : '打开其他工程';
  return <div className="modal-backdrop">
    <div className="modal" role="dialog" aria-modal="true" aria-label="未保存的修改">
      <h3>当前工程有未保存的修改</h3>
      <p>继续{target}会丢弃这些修改。</p>
      {gatewayKind === 'download' && <p className="scope-note">
        当前浏览器不支持直接写回文件：选择“保存并继续”只会请求下载副本，之后还需要点击“确认已导出”。
      </p>}
      {message && <p role="alert" className="input-error">{message}</p>}
      <div className="modal-actions">
        <button disabled={busy} onClick={() => onChoose('save')}>保存并继续</button>
        <button disabled={busy} onClick={() => onChoose('discard')}>不保存并继续</button>
        <button disabled={busy} onClick={() => onChoose('cancel')}>取消</button>
      </div>
    </div>
  </div>;
}
