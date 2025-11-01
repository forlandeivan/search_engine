import type { VercelRequest, VercelResponse } from "@vercel/node";
import app, { initApp } from "../app";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  await initApp();
  // @ts-ignore  // express совместим по сигнатуре
  return app(req, res);
}
