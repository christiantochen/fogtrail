import { useToast } from "../state/toast";

/** Confirms a copy. Centered at the bottom so it never covers the update notice. */
export function CopyToast() {
  const message = useToast((s) => s.message);
  if (!message) return null;
  return (
    <div className="toast toast--center" role="status" aria-live="polite">
      <p>{message}</p>
    </div>
  );
}
