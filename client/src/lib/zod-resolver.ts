import { toNestErrors, validateFieldsNatively } from "@hookform/resolvers";
import { appendErrors, type FieldError, type FieldErrors, type Resolver } from "react-hook-form";
import { ZodError, z, type ZodType } from "zod";

type ResolverOptions = {
  mode?: "sync" | "async";
  raw?: boolean;
};

function isZodError(error: unknown): error is ZodError {
  if (error instanceof ZodError) return true;
  const maybe = error as { issues?: unknown; errors?: unknown } | null;
  return Boolean(maybe && (Array.isArray(maybe.issues) || Array.isArray(maybe.errors)));
}

function getZodIssues(error: unknown): z.ZodIssue[] {
  const maybe = error as { issues?: unknown; errors?: unknown } | null;
  if (!maybe) return [];
  if (Array.isArray(maybe.issues)) return maybe.issues as z.ZodIssue[];
  if (Array.isArray(maybe.errors)) return maybe.errors as z.ZodIssue[];
  return [];
}

const parseErrorSchema = (zodIssues: z.ZodIssue[], validateAllFieldCriteria: boolean) => {
  const errors: Record<string, FieldError> = {};
  const issues = [...zodIssues];

  for (; issues.length; ) {
    const issue = issues[0];
    const { code, message, path } = issue;
    const _path = path.join(".");

    if (!errors[_path]) {
      if ("unionErrors" in issue) {
        const unionErrors = (issue as any).unionErrors as unknown[] | undefined;
        const unionError = unionErrors?.[0];
        const unionIssue =
          (unionError as unknown as { issues?: z.ZodIssue[]; errors?: z.ZodIssue[] } | undefined)?.issues?.[0] ??
          (unionError as unknown as { issues?: z.ZodIssue[]; errors?: z.ZodIssue[] } | undefined)?.errors?.[0];

        errors[_path] = {
          message: unionIssue?.message ?? message,
          type: unionIssue?.code ?? code,
        };
      } else {
        errors[_path] = { message, type: code };
      }
    }

    if ("unionErrors" in issue) {
      const unionErrors = (issue as any).unionErrors as unknown[] | undefined;
      unionErrors?.forEach((unionError: any) => {
        const nestedIssues =
          (unionError as unknown as { issues?: z.ZodIssue[]; errors?: z.ZodIssue[] } | undefined)?.issues ??
          (unionError as unknown as { issues?: z.ZodIssue[]; errors?: z.ZodIssue[] } | undefined)?.errors ??
          [];
        nestedIssues.forEach((e) => issues.push(e));
      });
    }

    if (validateAllFieldCriteria) {
      const types = errors[_path].types;
      const messages = types && (types as Record<string, unknown>)[issue.code];

      errors[_path] = appendErrors(
        _path,
        validateAllFieldCriteria,
        errors,
        code,
        messages ? ([] as string[]).concat(messages as string[], issue.message) : issue.message,
      ) as FieldError;
    }

    issues.shift();
  }

  return errors;
};

export function zodResolver<TFieldValues extends Record<string, any> = Record<string, any>>(
  schema: ZodType<TFieldValues>,
  schemaOptions?: Record<string, unknown>,
  resolverOptions: ResolverOptions = {}
): Resolver<TFieldValues> {
  return async (values, _, options) => {
    try {
      const data = await (resolverOptions.mode === "sync"
        ? schema.parse(values)
        : schema.parseAsync(values));

      options.shouldUseNativeValidation && validateFieldsNatively({}, options);

      return {
        errors: {} as Record<string, never>,
        values: resolverOptions.raw ? (values as TFieldValues) : (data as TFieldValues),
      };
    } catch (error: unknown) {
      if (isZodError(error)) {
        return {
          values: {} as Record<string, never>,
          errors: toNestErrors(
            parseErrorSchema(
              getZodIssues(error),
              !options.shouldUseNativeValidation && options.criteriaMode === "all",
            ),
            options,
          ),
        };
      }
      throw error;
    }
  };
}
