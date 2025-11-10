// server/api/health.ts
export default function handler(req: any, res: any) {
  res.status(200).json({
    ok: true,
    env: process.env.VERCEL_ENV || 'unknown',
  });
}
