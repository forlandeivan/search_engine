export default async function handler(req: any, res: any) {
  try {
    // Срезаем префикс /api
    if (typeof req.url === 'string') {
      req.url = req.url.replace(/^\/api(\/|$)/, '/');
    }

    // ЛЕНИВО грузим сервер, чтобы не падать на топ-левел импортов
    const mod = await import('../app');      // без типов, чтобы не требовать @vercel/node
    const app = (mod as any).default || (mod as any);
    const initApp = (mod as any).initApp;

    if (typeof initApp === 'function') {
      await initApp();
    }

    // --- Fastify ---
    if (app && app.server && typeof app.server.emit === 'function') {
      if (typeof app.ready === 'function') await app.ready();
      app.server.emit('request', req, res);
      return;
    }

    // --- Express fallback ---
    if (typeof app === 'function') {
      return app(req, res);
    }

    res.statusCode = 500;
    res.end('No handler');
  } catch (e) {
    console.error('Adapter error:', e);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: 'adapter_failed' }));
  }
}
