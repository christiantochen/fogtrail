import { create } from "zustand";

/** A short message that disappears by itself, such as "Copied". */
interface ToastState {
  message: string | null;
  show: (message: string) => void;
  clear: () => void;
}

let timer: number | undefined;

export const useToast = create<ToastState>((set) => ({
  message: null,
  show: (message) => {
    window.clearTimeout(timer);
    set({ message });
    timer = window.setTimeout(() => set({ message: null }), 2500);
  },
  clear: () => {
    window.clearTimeout(timer);
    set({ message: null });
  },
}));
