import assert from 'node:assert/strict';
import { createServer, preview } from 'vite';

async function verifyPage(server, mode) {
  const address = server.httpServer.address();
  assert(address && typeof address === 'object', `${mode}: 未取得监听地址`);
  const origin = `http://127.0.0.1:${address.port}`;
  const response = await fetch(origin);
  assert.equal(response.status, 200, `${mode}: 首页状态`);
  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /<title>土方开挖教学模拟器<\/title>/);
  assert.match(html, /id="root"/);
  const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  assert(assets.some((asset) => /\.(?:tsx|js)(?:\?|$)/.test(asset)), `${mode}: 缺少入口模块`);
  for (const asset of assets) {
    const url = new URL(asset, origin);
    assert.equal(url.origin, origin, `${mode}: 不得请求远程资源 ${asset}`);
    if (mode === 'preview') assert(asset.startsWith('./'), `构建资源必须使用相对路径: ${asset}`);
    const assetResponse = await fetch(url);
    assert.equal(assetResponse.status, 200, `${mode}: 资源不可访问 ${asset}`);
    const contentType = assetResponse.headers.get('content-type') ?? '';
    assert(!contentType.includes('text/html'), `${mode}: 资源请求意外返回 HTML`);
    assert((await assetResponse.text()).length > 0, `${mode}: 空资源 ${asset}`);
  }
  console.log(`${mode}: 首页与 ${assets.length} 个本地资源通过 HTTP 验证`);
}

const SHUTDOWN_TIMEOUT_MS = 10_000;

// vite 在 Windows 上偶发无法及时结束内部 watcher / 依赖优化进程，close() 会一直不 settle；
// 此时 HTTP 校验结果已经确定，因此关闭只做有限等待：超时后强制断开连接并记录警告，
// 由最后的显式退出结束进程，避免“校验通过却挂起”。
async function shutdown(label, server, close) {
  const result = await Promise.race([
    close().then(() => 'closed'),
    new Promise((resolve) => { setTimeout(() => resolve('timeout'), SHUTDOWN_TIMEOUT_MS); }),
  ]);
  if (result === 'timeout') {
    console.warn(`${label}: 服务未在 ${SHUTDOWN_TIMEOUT_MS / 1000}s 内关闭，强制断开连接后继续。`);
    server.httpServer?.closeAllConnections?.();
  }
}

const dev = await createServer({ server: { host: '127.0.0.1', port: 0, open: false } });
try {
  await dev.listen();
  await verifyPage(dev, 'dev');
} finally {
  await shutdown('dev', dev, () => dev.close());
}

const production = await preview({ preview: { host: '127.0.0.1', port: 0, open: false } });
try {
  await verifyPage(production, 'preview');
} finally {
  await shutdown('preview', production, () => new Promise((resolve, reject) => production.httpServer.close((error) => error ? reject(error) : resolve())));
}

// 校验失败会在上面抛出并以非零码结束；能走到这里说明两个阶段都通过。
await new Promise((resolve) => { process.stdout.write('', resolve); });
process.exit(0);
