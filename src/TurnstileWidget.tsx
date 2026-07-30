import { useEffect, useRef, useState } from "react";

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      theme: "auto";
      size: "flexible";
      callback: (token: string) => void;
      "error-callback": () => void;
      "expired-callback": () => void;
      "timeout-callback": () => void;
    },
  ): string;
  remove(widgetId: string): void;
  reset(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileLoader: Promise<TurnstileApi> | null = null;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileLoader) return turnstileLoader;

  turnstileLoader = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-xiaopan-turnstile="true"]',
    );
    const script = existing ?? document.createElement("script");

    const finish = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("Turnstile API did not initialize."));
    };

    script.addEventListener("load", finish, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Turnstile script failed to load.")),
      { once: true },
    );

    if (!existing) {
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.dataset.xiaopanTurnstile = "true";
      document.head.appendChild(script);
    }
  }).catch((error) => {
    turnstileLoader = null;
    throw error;
  });

  return turnstileLoader;
}

export default function TurnstileWidget(props: {
  siteKey: string;
  resetKey: number;
  onToken: (token: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(props.onToken);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    onTokenRef.current = props.onToken;
  }, [props.onToken]);

  useEffect(() => {
    let active = true;
    setLoadError(false);

    void loadTurnstile()
      .then((turnstile) => {
        if (!active || !containerRef.current) return;
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: props.siteKey,
          theme: "auto",
          size: "flexible",
          callback: (token) => onTokenRef.current(token),
          "error-callback": () => {
            onTokenRef.current("");
            setLoadError(true);
          },
          "expired-callback": () => onTokenRef.current(""),
          "timeout-callback": () => onTokenRef.current(""),
        });
      })
      .catch(() => {
        if (active) setLoadError(true);
      });

    return () => {
      active = false;
      const widgetId = widgetIdRef.current;
      if (widgetId && window.turnstile) {
        window.turnstile.remove(widgetId);
      }
      widgetIdRef.current = null;
      onTokenRef.current("");
    };
  }, [props.siteKey]);

  useEffect(() => {
    const widgetId = widgetIdRef.current;
    if (widgetId && window.turnstile) {
      window.turnstile.reset(widgetId);
      onTokenRef.current("");
      setLoadError(false);
    }
  }, [props.resetKey]);

  return (
    <div className="turnstile-wrap">
      <div ref={containerRef} className="turnstile-widget" />
      {loadError && (
        <small className="turnstile-error">
          人机验证加载失败，请检查网络或刷新页面后重试。
        </small>
      )}
    </div>
  );
}
