import { useEffect, useRef } from "react";

/**
 * Keeps Esc from reaching the OS while a panel or dialog is open. On macOS an Esc nobody handled
 * leaves native full screen, which happens whenever focus is outside the element's own key handler
 * (after clicking plain text, say). Every Esc is marked as handled before anything else sees it.
 *
 * Pass `onEscape` to also act on an Esc that no inner handler took (one that stops propagation, such
 * as a search box clearing itself, goes first). Without it, the key is only kept from the OS.
 */
export function useEscape(onEscape?: () => void) {
  const act = useRef(onEscape);
  useEffect(() => {
    act.current = onEscape;
  });
  useEffect(() => {
    const guard = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.preventDefault();
    };
    const run = (e: KeyboardEvent) => {
      if (e.key === "Escape") act.current?.();
    };
    window.addEventListener("keydown", guard, true);
    window.addEventListener("keydown", run);
    return () => {
      window.removeEventListener("keydown", guard, true);
      window.removeEventListener("keydown", run);
    };
  }, []);
}
