import type { AppError } from "./types";

// Every backend call rejects with an AppError, so queries and mutations are typed that way.
declare module "@tanstack/react-query" {
  interface Register {
    defaultError: AppError;
  }
}
