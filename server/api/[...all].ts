// server/api/[...all].ts
import app, { initApp } from '../app';

export default async function handler(req: any, res: any) {
  try {
    // Инициализация приложения (БД и т.п.), если есть
    if (typeof initApp === 'function') {
      await initApp();
    }

    // Vercel отдаёт урлы как /api/..., а у нас роуты без /api
    if (typeof req.url === 'string') {
      req.url = req.url.replace(/^\/api(\/|$)/, '/');
    }

    // --- АДАПТЕР ДЛЯ FASTIFY ---
    // Fastify имеет .server.emit('request', req, res)
    if (app && app.server && typeof app.server.emit === 'function') {
      // На всякий случай дождёмся готовности роутов
      if (typeof app.ready === 'function') {
        await app.ready();
      }
      app.server.emit('request', req, res);
      return;
    }

    // --- ФОЛБЭК НА EXPRESS (если вдруг app — это express) ---
    // @ts-ignore
    return app(req, res);
  } catch (e) {
    console.error('API adapter failed:', e);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: 'adapter_failed' }));
  }
}
