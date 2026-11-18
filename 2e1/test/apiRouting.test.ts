import { describe, it, expect } from 'vitest';
import http from 'node:http';
import handler from '../api/index';

async function callServerlessHandler(url: string, method = 'GET', body?: any) {
  const server = http.createServer((req, res) => {
    void handler(req, res);
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  try {
    const resp = await fetch(`http://127.0.0.1:${addr.port}${url}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await resp.text();
    return { status: resp.status, text };
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

describe('Vercel Serverless API Routing (/api/index)', () => {
  it('routes direct /api/health and Vercel rewritten /api/index?__vpath=health to 200 OK', async () => {
    const direct = await callServerlessHandler('/api/health');
    expect(direct.status).toBe(200);
    expect(JSON.parse(direct.text)).toMatchObject({
      status: 'ok',
      model: 'gemini-3-flash-preview',
    });

    const rewritten = await callServerlessHandler('/api/index?__vpath=health');
    expect(rewritten.status).toBe(200);
    expect(JSON.parse(rewritten.text)).toMatchObject({
      status: 'ok',
      model: 'gemini-3-flash-preview',
    });
  });

  it('routes Vercel rewritten /api/index?__vpath=v2/kernel/neural-matrix-compute without 404', async () => {
    const res = await callServerlessHandler(
      '/api/index?__vpath=v2/kernel/neural-matrix-compute',
      'POST',
      { contents: [] }
    );
    expect(res.status).toBe(200);
    expect(res.text).toContain('Dữ liệu hội thoại gửi lên không hợp lệ');
  });
});
