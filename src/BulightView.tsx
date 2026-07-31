import { useEffect } from "react";
import { ArrowLeft, ExternalLink, Sun } from "lucide-react";

const BULIGHT_URL = "https://bulight-cn.netlify.app";

export default function BulightView({ onBack }: { onBack: () => void }) {
  useEffect(() => {
    document.body.classList.add("bulight-view-active");
    return () => document.body.classList.remove("bulight-view-active");
  }, []);

  return (
    <div className="bulight-shell">
      <header className="bulight-topbar">
        <div className="bulight-topbar-main">
          <button
            type="button"
            className="secondary-button bulight-back"
            onClick={onBack}
          >
            <ArrowLeft size={17} />
            返回云盘
          </button>
          <div className="bulight-identity">
            <span className="bulight-icon" aria-hidden="true">
              <Sun size={19} />
            </span>
            <span>
              <strong>屏幕补光灯</strong>
              <small>柔和、可调节的全屏灯板</small>
            </span>
          </div>
        </div>
        <a
          className="secondary-button bulight-external"
          href={BULIGHT_URL}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={16} />
          新窗口打开
        </a>
      </header>

      <main className="bulight-frame-wrap">
        <iframe
          className="bulight-frame"
          src={BULIGHT_URL}
          title="屏幕补光灯"
          allow="fullscreen; screen-wake-lock"
          allowFullScreen
        />
      </main>
    </div>
  );
}
