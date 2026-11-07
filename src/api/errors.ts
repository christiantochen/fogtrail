import type { AppError } from "./types";

/** Turns whatever `invoke` rejected with into an {@link AppError}. */
export function toAppError(err: unknown): AppError {
  if (typeof err === "object" && err !== null) {
    const { kind, message } = err as Record<string, unknown>;
    if (typeof kind === "string" && typeof message === "string") {
      return { kind: kind as AppError["kind"], message };
    }
  }
  return {
    kind: "unknown",
    message: typeof err === "string" ? err : "Something went wrong.",
  };
}
