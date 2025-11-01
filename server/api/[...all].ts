// server/api/[...all].ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import app, { initApp } from '../app';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  await initApp();
  // @ts-ignore
  return app(req, res);
}
