// server/api/[...all].ts
import app, { initApp } from '../app';

export default async function handler(req: any, res: any) {
  try {
    // Стрипаем префикс /api
    const orig = typeof req.url === 'string' ? req.url : '';
    const stripped = orig.replace(/^\/api(\/|$)/, '/');
    if (stripped !== orig) req.url = stripped;

    // --- КОРОТКАЯ ОТВЕТКА ДЛЯ HEALTH ---
    if (req.method === 'GET' && (stripped === '/health' || stripped.startsWith('/health?'))) {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: true, env: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown' }));
      return;
    }
    // ------------------------------------

    // Остальные маршруты — с инициализацией
    if (typeof initApp === 'function') {
      await initApp();
    }

    // Fastify-адаптер
    if (app && app.server && typeof app.server.emit === 'function') {
      if (typeof app.ready === 'function') await app.ready();
      app.server.emit('request', req, res);
      return;
    }

    // Fallback на Express
    // @ts-ignore
    return app(req, res);
  } catch (e) {
    console.error('API adapter failed:', e);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: 'adapter_failed' }));
  }
}
