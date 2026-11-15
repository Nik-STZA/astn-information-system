"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// While a candidate is with the reviewer, reload the list every 15 seconds so
// its proposal appears without a manual refresh. Stops when nothing is waiting
// or the tab is hidden.
export default function RegistryCandidatesRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 15000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}
