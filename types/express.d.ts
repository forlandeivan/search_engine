import type { PublicUser } from "@shared/schema";

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface User extends PublicUser {}
  }
}

export {};
