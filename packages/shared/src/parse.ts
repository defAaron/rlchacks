import type { z } from "zod";
import { GraftArtifactParseError, type GraftArtifactIssue } from "./errors.js";

export function parseArtifact<T>(
  schema: z.ZodType<T>,
  data: unknown,
  artifact: string,
): T {
  const result = schema.safeParse(data);
  if (result.success) {
    return result.data;
  }

  const issues: GraftArtifactIssue[] = result.error.issues.map((issue) => ({
    path: issue.path,
    message: issue.message,
    code: issue.code,
  }));

  throw new GraftArtifactParseError(artifact, issues);
}
