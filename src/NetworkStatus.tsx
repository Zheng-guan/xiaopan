import { useEffect, useRef, useState } from "react";

type NetworkMessage = "offline" | "restored" | null;

export default function NetworkStatus() {
  const [message, setMessage] = useState<NetworkMessage>(() =>
    navigator.onLine ? null : "offline",
  );
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
    const handleOffline = () => {
      clearTimer();
      setMessage("offline");
    };
    const handleOnline = () => {
      clearTimer();
      setMessage("restored");
      timer.current = window.setTimeout(() => setMessage(null), 3200);
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      clearTimer();
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  if (!message) return null;

  return (
    <div
      className={`network-status ${message}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="network-status-dot" aria-hidden="true" />
      {message === "offline"
        ? "网络已断开，上传可能暂停，恢复连接后可继续。"
        : "网络连接已恢复。"}
    </div>
  );
}
