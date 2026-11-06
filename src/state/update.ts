import { create } from "zustand";

/** Where the self-update flow stands. Shown by UpdateToast. */
export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  | { kind: "available"; version: string; notes: string | null }
  | {
      kind: "downloading";
      version: string;
      downloaded: number;
      total: number | null;
    }
  | { kind: "restarting"; version: string }
  | { kind: "error"; message: string };

interface UpdateState {
  status: UpdateStatus;
  set: (status: UpdateStatus) => void;
}

export const useUpdate = create<UpdateState>((set) => ({
  status: { kind: "idle" },
  set: (status) => set({ status }),
}));
