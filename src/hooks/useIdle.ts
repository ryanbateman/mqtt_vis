import { useEffect, useState } from "react";

/** User-activity events that count as "not idle". */
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "wheel"] as const;

/**
 * Track whether the user has been inactive for `timeoutMs`. Returns `true` once
 * no activity event has fired for that long, flipping back to `false` on the
 * next interaction. When `enabled` is false the hook detaches its listeners and
 * always reports `false` (active).
 *
 * Used in embed/kiosk mode to auto-hide the cursor and to pause/resume the
 * kiosk auto-tour while someone is interacting with the graph.
 */
export function useIdle(enabled: boolean, timeoutMs: number): boolean {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setIdle(false);
      return;
    }

    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      timer = setTimeout(() => setIdle(true), timeoutMs);
    };
    const onActivity = () => {
      setIdle(false);
      clearTimeout(timer);
      arm();
    };

    arm();
    ACTIVITY_EVENTS.forEach((e) =>
      window.addEventListener(e, onActivity, { passive: true }),
    );
    return () => {
      clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, [enabled, timeoutMs]);

  return idle;
}
