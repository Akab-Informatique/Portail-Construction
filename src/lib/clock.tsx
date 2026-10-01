import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "./auth";
import { useWorkspace } from "./workspace";
import { openPunchForUser, PUNCH_CHANGED_EVENT } from "./timeclock";
import type { Project, TimePunch } from "./types";

type ClockValue = {
  /** The open check-in, if the user is on the clock. Stored server-side, so it survives sign-out. */
  open: TimePunch | null;
  openProject: Project | null;
  refresh: () => Promise<void>;
};

const ClockContext = createContext<ClockValue>({ open: null, openProject: null, refresh: async () => undefined });

export function ClockProvider({ children }: { children: ReactNode }) {
  const { realUser } = useAuth();
  const { projects } = useWorkspace();
  const [open, setOpen] = useState<TimePunch | null>(null);
  const staff = realUser?.user_type === "internal" && !realUser.must_change_password;

  const refresh = useCallback(async () => {
    if (!realUser || !staff) {
      setOpen(null);
      return;
    }
    try {
      setOpen(await openPunchForUser(realUser.id));
    } catch (err) {
      console.error("clock status failed", err);
    }
  }, [realUser, staff]);

  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
    // Re-check when returning to the tab: the shift may have been closed on another device.
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener(PUNCH_CHANGED_EVENT, onChange);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(PUNCH_CHANGED_EVENT, onChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const value = useMemo(
    () => ({ open, openProject: open ? projects.find((p) => p.id === open.project_id) ?? null : null, refresh }),
    [open, projects, refresh],
  );
  return <ClockContext.Provider value={value}>{children}</ClockContext.Provider>;
}

export function useClock() {
  return useContext(ClockContext);
}

/** Current time, re-rendering every `ms` while `active`. */
export function useNow(active: boolean, ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [active, ms]);
  return now;
}
