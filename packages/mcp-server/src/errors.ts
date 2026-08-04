/**
 * Map Graft errors to MCP tool error payloads (TRD §8.3).
 */

import {
  GraftError,
  GraftErrorCodes,
  type GraftErrorCode,
} from "@graft/shared";

export type McpToolErrorBody = {
  code: GraftErrorCode;
  message: string;
};

export function toMcpToolError(err: unknown): McpToolErrorBody {
  if (err instanceof GraftError) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof Error) {
    return { code: GraftErrorCodes.GRAFT_NO_DATA, message: err.message };
  }
  return {
    code: GraftErrorCodes.GRAFT_NO_DATA,
    message: String(err),
  };
}

export function isGraftErrorCode(code: string): code is GraftErrorCode {
  return Object.values(GraftErrorCodes).includes(code as GraftErrorCode);
}
