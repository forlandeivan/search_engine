// server/api/[...all].ts
import app, { initApp } from '../app';

export default async function handler(req: any, res: any) {
  if (typeof initApp === 'function') {
    await initApp();
  }
  // делегируем в Express
  // @ts-ignore совместимо по используемым полям123
  return app(req, res);
}
