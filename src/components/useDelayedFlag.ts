import { useEffect, useState } from "react";

/** `flag`, but only once it has been true for `ms`: a quick load shows nothing, so nothing flickers. */
export function useDelayedFlag(flag: boolean, ms: number): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!flag) return;
    const t = setTimeout(() => setOn(true), ms);
    return () => {
      clearTimeout(t);
      setOn(false);
    };
  }, [flag, ms]);
  return flag && on;
}
