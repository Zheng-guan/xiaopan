import { useEffect, useState } from "react";
import {
  Check,
  CircleAlert,
  Cloud,
  Copy,
  Download,
  ExternalLink,
  File,
  Link2,
  LoaderCircle,
  Quote,
  ShieldCheck,
} from "lucide-react";
import { formatBytes, formatDate } from "./lib/format";
import { getPublicFileDownload, getPublicShare } from "./lib/shares";
import type { PublicShare } from "./types";

function typeIcon(type: PublicShare["type"]) {
  if (type === "text") return <Quote size={23} />;
  if (type === "link") return <Link2 size={23} />;
  return <File size={23} />;
}

export default function PublicShareView({ token }: { token: string }) {
  const [share, setShare] = useState<PublicShare | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    void getPublicShare(token)
      .then((value) => {
        if (active) setShare(value);
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "分享无法访问");
      });
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <main className="public-share-shell">
      <header className="public-share-topbar">
        <a href="/" className="brand-lockup">
          <span className="brand-mark"><Cloud size={23} /></span>
          <span>小盘</span>
        </a>
        <span><ShieldCheck size={15} /> 安全公开分享</span>
      </header>

      <section className="public-share-stage">
        {error ? (
          <div className="public-share-error" role="alert" aria-live="assertive">
            <span><CircleAlert size={24} /></span>
            <h1>无法打开分享</h1>
            <p>{error}</p>
            <a className="secondary-button" href="/">返回小盘</a>
          </div>
        ) : !share ? (
          <div className="public-share-loading" role="status" aria-live="polite">
            <LoaderCircle className="spin" size={27} />
            <strong>正在安全读取分享</strong>
          </div>
        ) : (
          <article className={`public-share-card ${share.type}`}>
            <div className="public-share-kind">
              <span>{typeIcon(share.type)}</span>
              <small>
                {share.type === "text" ? "文字分享" : share.type === "link" ? "网页链接" : "文件分享"}
              </small>
            </div>
            <h1>{share.title}</h1>
            <div className="public-share-meta">
              <span>分享于 {formatDate(share.createdAt)}</span>
              <span>{share.expiresAt ? `${formatDate(share.expiresAt)} 到期` : "长期有效"}</span>
            </div>

            {share.type === "text" && (
              <div className="public-text-content">{share.textContent}</div>
            )}

            {share.type === "link" && share.linkUrl && (
              <div className="public-link-content">
                <Link2 size={21} />
                <span title={share.linkUrl}>{share.linkUrl}</span>
              </div>
            )}

            {share.type === "file" && share.file && (
              <div className="public-file-content">
                <span><File size={25} /></span>
                <div>
                  <strong>{share.file.name}</strong>
                  <small>{formatBytes(share.file.size)} · {share.file.mimeType || "未知类型"}</small>
                </div>
              </div>
            )}

            <div className="public-share-actions">
              {share.type === "text" && (
                <button
                  className="primary-button"
                  aria-live="polite"
                  onClick={() => {
                    void navigator.clipboard.writeText(share.textContent || "").then(() => {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1800);
                    });
                  }}
                >
                  {copied ? <Check size={17} /> : <Copy size={17} />}
                  {copied ? "已复制" : "复制文字"}
                </button>
              )}
              {share.type === "link" && share.linkUrl && (
                <a className="primary-button" href={share.linkUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={17} /> 打开网页
                </a>
              )}
              {share.type === "file" && (
                <button
                  className="primary-button"
                  disabled={downloading}
                  aria-busy={downloading}
                  onClick={() => {
                    setDownloading(true);
                    void getPublicFileDownload(token)
                      .then((url) => {
                        window.location.assign(url);
                      })
                      .catch((downloadError) =>
                        setError(downloadError instanceof Error ? downloadError.message : "下载失败"),
                      )
                      .finally(() => setDownloading(false));
                  }}
                >
                  {downloading ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}
                  下载文件
                </button>
              )}
            </div>
            <footer>此内容由小盘安全分享 · 共查看 {share.viewCount} 次</footer>
          </article>
        )}
      </section>
    </main>
  );
}
