// server/api/[...all].ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

function stripApiPrefix(req: VercelRequest) {
  (req as any).url = (req.url || '/').replace(/^\/api(?=\/|$)/, '') || '/';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // грузим твой сервер: сперва пробуем app.ts, затем index.ts
  const mod = await import('../app').catch(async () => await import('../index'));
  let candidate: any = (mod as any).default ?? mod;

  // Вариант 1: экспортирован обработчик (Express/any) в виде функции (req,res) => ...
  if (typeof candidate === 'function') {
    stripApiPrefix(req);
    return candidate(req as any, res as any);
  }

  // Вариант 2: экспортирован фабричный метод getServer() (часто у Fastify)
  if (typeof (mod as any).getServer === 'function') {
    candidate = await (mod as any).getServer();
  } else if (typeof (mod as any).default === 'function') {
    candidate = await (mod as any).default();
  }

  // Вариант 3: Fastify instance (.server.emit)
  if (candidate?.server?.emit) {
    if (typeof candidate.ready === 'function') {
      await candidate.ready();
    }
    stripApiPrefix(req);
    candidate.server.emit('request', req, res);
    return;
  }

  // Вариант 4: Express instance имеет .handle()
  if (typeof candidate?.handle === 'function') {
    stripApiPrefix(req);
    return candidate.handle(req as any, res as any);
  }

  // Ничего из перечисленного не подошло — подсказка как починить
  return res.status(500).json({
    ok: false,
    error:
      'Handler not found. Экспортируй либо функцию (req,res)=>..., либо getServer(), либо Express/Fastify instance из server/app.ts или server/index.ts.',
  });
}
