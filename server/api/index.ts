// server/api/index.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import app, { initApp } from "../app";

// Для Serverless Functions: инициируем приложение один раз и проксируем запросы в Express
export default async function handler(req: VercelRequest, res: VercelResponse) {
  await initApp();
  // сигнатуры совместимы
  // @ts-ignore
  return app(req, res);
}
