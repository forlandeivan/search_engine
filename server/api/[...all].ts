// server/api/[...all].ts
import app, { initApp } from '../app';

export default async function handler(req: any, res: any) {
  try {
    // Срежем префикс /api, Vercel вызывает функции как /api/...
    const originalUrl = typeof req.url === 'string' ? req.url : '';
    const strippedUrl = originalUrl.replace(/^\/api(\/|$)/, '/');
    if (strippedUrl !== originalUrl) req.url = strippedUrl;

    // Health — без initApp(), чтобы не требовать БД/секреты
    const isHealth = strippedUrl === '/health' || strippedUrl.startsWith('/health?');

    if (!isHealth && typeof initApp === 'function') {
      await initApp();
    }

    // --- Адаптер для Fastify ---
    if (app && app.server && typeof app.server.emit === 'function') {
      if (typeof app.ready === 'function') {
        await app.ready();
      }
      app.server.emit('request', req, res);
      return;
    }

    // --- Fallback на Express ---
    // @ts-ignore
    return app(req, res);
  } catch (e) {
    console.error('API adapter failed:', e);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: 'adapter_failed' }));
  }
}
