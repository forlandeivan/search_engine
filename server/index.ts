import app, { initApp } from "./app";
import { log } from "./vite";

const port = parseInt(process.env.PORT || "5000", 10);

// На Vercel этот файл не запускается (мы используем server/api/index.ts).
// На Replit/локально — стартуем HTTP-сервер.
if (!process.env.VERCEL) {
  void initApp().then(() => {
    app.listen({ port, host: "0.0.0.0" } as any, () => {
      log(`serving on port ${port}`);
    });
  });
}

export default app;
