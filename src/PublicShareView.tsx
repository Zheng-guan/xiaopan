import { useEffect, useRef, useState } from "react";
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
  X,
} from "lucide-react";
import {
  cancelAdaptiveDownload,
  startAdaptiveDownload,
  startDirectDownload,
  subscribeAdaptiveDownloads,
} from "./lib/download";
import { formatBytes, formatDate, formatRemainingTime, formatSpeed } from "./lib/format";
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
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState({
    downloaded: 0,
    total: 0,
    speed: 0,
    concurrency: 0,
  });
  const [copied, setCopied] = useState(false);
  const downloadId = useRef<string | null>(null);

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

  useEffect(
    () =>
      subscribeAdaptiveDownloads((event) => {
        if (event.id !== downloadId.current) return;
        if (event.type === "progress") {
          setDownloadProgress({
            downloaded: event.downloaded,
            total: event.total,
            speed: event.speed,
            concurrency: event.concurrency,
          });
        } else if (["complete", "fallback", "cancelled"].includes(event.type)) {
          setDownloading(false);
          downloadId.current = null;
        } else if (event.type === "error") {
          setDownloading(false);
          setDownloadError(event.error);
          downloadId.current = null;
        }
      }),
    [],
  );

  async function toggleFileDownload() {
    if (downloading && downloadId.current) {
      const id = downloadId.current;
      downloadId.current = null;
      setDownloading(false);
      await cancelAdaptiveDownload(id);
      return;
    }
    if (!share?.file) return;

    const id = crypto.randomUUID();
    downloadId.current = id;
    setDownloading(true);
    setDownloadError(null);
    setDownloadProgress({
      downloaded: 0,
      total: share.file.size,
      speed: 0,
      concurrency: 0,
    });
    try {
      const url = await getPublicFileDownload(token);
      if (downloadId.current !== id) return;
      const adaptive = await startAdaptiveDownload({
        id,
        url,
        fileName: share.file.name,
        size: share.file.size,
        mimeType: share.file.mimeType,
      });
      if (downloadId.current !== id) {
        await cancelAdaptiveDownload(id);
        return;
      }
      if (!adaptive) {
        startDirectDownload(url, share.file.name);
        setDownloading(false);
        downloadId.current = null;
      }
    } catch (downloadFailure) {
      if (downloadId.current !== id) return;
      setDownloading(false);
      downloadId.current = null;
      setDownloadError(
        downloadFailure instanceof Error ? downloadFailure.message : "下载失败",
      );
    }
  }

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
          <div className="public-share-error">
            <span><CircleAlert size={24} /></span>
            <h1>无法打开分享</h1>
            <p>{error}</p>
            <a className="secondary-button" href="/">返回小盘</a>
          </div>
        ) : !share ? (
          <div className="public-share-loading">
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
                <div className="public-download-control">
                  <button className="primary-button" onClick={() => void toggleFileDownload()}>
                    {downloading ? <X size={17} /> : <Download size={17} />}
                    {downloading ? "取消下载" : "下载文件"}
                  </button>
                  {downloading && (
                    <small>
                      {downloadProgress.total > 0
                        ? `${Math.min(100, (downloadProgress.downloaded / downloadProgress.total) * 100).toFixed(0)}% · `
                        : ""}
                      {formatSpeed(downloadProgress.speed)} · {downloadProgress.concurrency || 1} 路并发
                      {downloadProgress.speed > 0 &&
                        ` · 预计剩余 ${formatRemainingTime(
                          (downloadProgress.total - downloadProgress.downloaded) /
                            downloadProgress.speed,
                        )}`}
                    </small>
                  )}
                  {downloadError && <small className="download-error">{downloadError}</small>}
                </div>
              )}
            </div>
            <footer>此内容由小盘安全分享 · 共查看 {share.viewCount} 次</footer>
          </article>
        )}
      </section>
    </main>
  );
}
