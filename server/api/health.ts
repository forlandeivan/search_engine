export default async function handler(_req: any, res: any) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true,
    env: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown'
  }));
}
