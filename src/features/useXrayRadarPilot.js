import { useEffect, useState } from "react";
import { matchesXrayPilotEmail } from "../mySpaceXray";

// This only controls feature visibility; published exam access is still enforced by the existing API.
const pilotDigest = import.meta.env.VITE_XRAY_RADAR_PILOT_EMAIL_SHA256?.trim().toLowerCase();

export function useXrayRadarPilot(user) {
  const email = String(user?.email ?? "").trim().toLowerCase();
  const actor = email && user?.id && ["resident", "staff", "admin"].includes(user.role) ? `${user.id}/${user.role}/${email}` : "";
  const [matched, setMatched] = useState("");
  useEffect(() => {
    if (!actor || !pilotDigest) return;
    let live = true;
    matchesXrayPilotEmail(email, pilotDigest)
      .then((allowed) => { if (live) setMatched(allowed ? actor : ""); })
      .catch(() => { if (live) setMatched(""); });
    return () => { live = false; };
  }, [actor, email]);
  return Boolean(actor && matched === actor);
}
