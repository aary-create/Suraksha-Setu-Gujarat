"use client";
import { useEffect, useState } from "react";
import { Bell } from "./Icon";
import type { T } from "@/lib/i18n";

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

// A push subscription needs the VAPID key as a byte array, not base64url.
function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// Polling only warns someone who is already looking at the screen. This is
// the one thing that reaches a phone in a pocket, so it's worth asking for —
// but asked once, quietly, and never again once answered.
export default function AlertsOptIn({ lat, lng, language, t }: { lat: number; lng: number; language: string; t: T }) {
  const [state, setState] = useState<"hidden" | "offer" | "working" | "on" | "blocked">("hidden");

  useEffect(() => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") return setState("on");
    if (Notification.permission === "denied") return setState("blocked");
    setState("offer");
  }, []);

  async function enable() {
    setState("working");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return setState(permission === "denied" ? "blocked" : "offer");
    setState("on");

    // Local notifications already work at this point. Push is an upgrade on
    // top, and only possible if the deployment has VAPID keys configured.
    if (!VAPID) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID),
        }));
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON(), lat, lng, language }),
      });
    } catch (err) {
      // Local notifications still work; nothing to escalate to the user.
      console.warn("[push] subscribe failed", err);
    }
  }

  if (state === "hidden" || state === "on") return null;

  return (
    <div className="optin">
      <Bell size={20} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="optin-title">{t("notifyTitle")}</p>
        <p className="muted small" style={{ margin: "2px 0 0" }}>
          {state === "blocked" ? t("notifyBlocked") : t("notifySub")}
        </p>
      </div>
      {state !== "blocked" && (
        <button type="button" className="btn ghost optin-btn" onClick={enable} disabled={state === "working"}>
          {state === "working" ? t("saving") : t("notifyOn")}
        </button>
      )}
    </div>
  );
}
