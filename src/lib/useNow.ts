import { useSyncExternalStore } from "react";

// One clock for the whole app: a single timer however many rows are counting down.
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let now = Date.now();

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (listeners.size === 1) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) clearInterval(timer);
  };
}

/** The current time in ms, updated once a second. */
export const useNow = () =>
  useSyncExternalStore(
    subscribe,
    () => now,
    () => now,
  );
