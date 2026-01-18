import { zodResolver as baseResolver } from "@hookform/resolvers/zod";
import type { ZodTypeAny } from "zod";

export const zodResolver = (schema: unknown): ReturnType<typeof baseResolver> =>
  baseResolver(schema as ZodTypeAny);
