import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowLeft,
  Check,
  Clock3,
  Cloud,
  Copy,
  ExternalLink,
  Eye,
  File,
  Link2,
  LoaderCircle,
  LogOut,
  Quote,
  RefreshCw,
  Share2,
  Trash2,
} from "lucide-react";
import { listAllFiles } from "./lib/drive";
import { formatBytes, formatDate, initials } from "./lib/format";
import {
  createShare,
  deleteShare,
  listShares,
  publicShareUrl,
} from "./lib/shares";
import { supabase } from "./lib/supabase";
import type { DriveItem, ShareRecord, ShareType } from "./types";

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}

function typeLabel(type: ShareType) {
  if (type === "text") return "文字";
  if (type === "link") return "链接";
  return "文件";
}

function typeIcon(type: ShareType, size = 17) {
  if (type === "text") return <Quote size={size} />;
  if (type === "link") return <Link2 size={size} />;
  return <File size={size} />;
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

export default function ShareCenter(props: {
  session: Session;
  initialFile: DriveItem | null;
  onBack: () => void;
  onInitialFileHandled: () => void;
}) {
  const userId = props.session.user.id;
  const [shares, setShares] = useState<ShareRecord[]>([]);
  const [files, setFiles] = useState<DriveItem[]>([]);
  const [type, setType] = useState<ShareType>(props.initialFile ? "file" : "text");
  const [title, setTitle] = useState(props.initialFile?.name ?? "");
  const [content, setContent] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [fileId, setFileId] = useState<number | "">(props.initialFile?.id ?? "");
  const [expiryDays, setExpiryDays] = useState("7");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextShares, nextFiles] = await Promise.all([
        listShares(userId),
        listAllFiles(userId),
      ]);
      setShares(nextShares);
      setFiles(nextFiles);
    } catch (loadError) {
      setError(messageFrom(loadError));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!props.initialFile) return;
    setType("file");
    setFileId(props.initialFile.id);
    setTitle(props.initialFile.name);
    props.onInitialFileHandled();
  }, [props]);

  const selectedFile = useMemo(
    () => files.find((file) => file.id === fileId) ?? props.initialFile,
    [fileId, files, props.initialFile],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    setNotice(null);
    setCreatedUrl(null);
    try {
      const days = Number(expiryDays);
      const expiresAt =
        days > 0
          ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
          : null;
      const result = await createShare({
        userId,
        type,
        title,
        textContent: content,
        linkUrl,
        file: selectedFile ?? undefined,
        expiresAt,
      });
      const url = publicShareUrl(result.public_id);
      setCreatedUrl(url);
      setNotice("分享已创建，可以复制链接发送给其他人。");
      await copyText(url).catch(() => undefined);
      setTitle("");
      setContent("");
      setLinkUrl("");
      setFileId("");
      await load();
    } catch (createError) {
      setError(messageFrom(createError));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="share-center-shell">
      <header className="share-center-topbar">
        <div className="brand-lockup">
          <span className="brand-mark"><Cloud size={23} /></span>
          <span>小盘</span>
          <span className="share-brand-badge">分享中心</span>
        </div>
        <div className="share-center-account">
          <span className="avatar compact">{initials(props.session.user.email)}</span>
          <span>{props.session.user.email}</span>
          <button className="icon-button" title="退出登录" onClick={() => void supabase.auth.signOut()}>
            <LogOut size={17} />
          </button>
        </div>
      </header>

      <main className="share-center-main">
        <div className="share-center-heading">
          <div>
            <span className="eyebrow dark"><Share2 size={15} /> 多类型安全分享</span>
            <h1>分享中心</h1>
            <p>分享文件、文字或网页链接，并随时取消公开访问。</p>
          </div>
          <button className="secondary-button" onClick={props.onBack}>
            <ArrowLeft size={17} /> 返回我的云盘
          </button>
        </div>

        <div className="share-center-grid">
          <section className="share-create-panel">
            <div className="share-panel-title">
              <div>
                <h2>新建分享</h2>
                <p>公开链接使用随机安全令牌，可选择有效期。</p>
              </div>
            </div>

            <div className="share-type-switch" role="tablist" aria-label="分享类型">
              {(["text", "link", "file"] as ShareType[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={type === item}
                  className={type === item ? "active" : ""}
                  onClick={() => {
                    setType(item);
                    setError(null);
                    setCreatedUrl(null);
                  }}
                >
                  {typeIcon(item)}
                  {typeLabel(item)}
                </button>
              ))}
            </div>

            <form className="share-create-form" onSubmit={submit}>
              <label>
                <span>分享标题</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={160}
                  placeholder={
                    type === "text"
                      ? "例如：会议记录"
                      : type === "link"
                        ? "例如：值得收藏的网站"
                        : "例如：项目资料"
                  }
                  required
                />
              </label>

              {type === "text" && (
                <label>
                  <span>文字内容</span>
                  <textarea
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    maxLength={100000}
                    placeholder="输入要分享的一段文字、笔记、清单或代码……"
                    required
                  />
                  <small>{content.length.toLocaleString()} / 100,000 字</small>
                </label>
              )}

              {type === "link" && (
                <label>
                  <span>网页地址</span>
                  <input
                    type="url"
                    value={linkUrl}
                    onChange={(event) => setLinkUrl(event.target.value)}
                    placeholder="https://example.com"
                    required
                  />
                </label>
              )}

              {type === "file" && (
                <label>
                  <span>选择文件</span>
                  <select
                    value={fileId}
                    onChange={(event) => setFileId(Number(event.target.value) || "")}
                    required
                  >
                    <option value="">选择云盘中的文件</option>
                    {files.map((file) => (
                      <option key={file.id} value={file.id}>
                        {file.name} · {formatBytes(file.size)}
                      </option>
                    ))}
                  </select>
                  {files.length === 0 && <small>云盘中还没有可分享的文件。</small>}
                </label>
              )}

              <label>
                <span>有效期</span>
                <select value={expiryDays} onChange={(event) => setExpiryDays(event.target.value)}>
                  <option value="1">1 天</option>
                  <option value="7">7 天</option>
                  <option value="30">30 天</option>
                  <option value="0">永久有效，直到手动取消</option>
                </select>
              </label>

              {error && <div className="share-inline-message error">{error}</div>}
              {notice && (
                <div className="share-inline-message success">
                  <Check size={16} />
                  <span>{notice}</span>
                </div>
              )}
              {createdUrl && (
                <div className="created-share-url">
                  <span title={createdUrl}>{createdUrl}</span>
                  <button type="button" onClick={() => void copyText(createdUrl)}>
                    <Copy size={15} /> 复制
                  </button>
                </div>
              )}

              <button className="primary-button share-create-submit" disabled={creating}>
                {creating ? <LoaderCircle className="spin" size={17} /> : <Share2 size={17} />}
                创建{typeLabel(type)}分享
              </button>
            </form>
          </section>

          <section className="share-list-panel">
            <div className="share-panel-title">
              <div>
                <h2>我的分享</h2>
                <p>{shares.length} 条分享，可复制、预览或取消。</p>
              </div>
              <button className="icon-button" onClick={() => void load()} disabled={loading} title="刷新">
                <RefreshCw className={loading ? "spin" : ""} size={17} />
              </button>
            </div>

            {loading && shares.length === 0 ? (
              <div className="share-list-empty">
                <LoaderCircle className="spin" size={24} />
                <span>正在加载分享</span>
              </div>
            ) : shares.length === 0 ? (
              <div className="share-list-empty">
                <Share2 size={27} />
                <strong>还没有分享</strong>
                <span>从左侧创建第一条公开分享。</span>
              </div>
            ) : (
              <div className="share-list">
                {shares.map((share) => {
                  const expired =
                    Boolean(share.expires_at) &&
                    new Date(share.expires_at as string).getTime() <= Date.now();
                  const url = publicShareUrl(share.public_id);
                  return (
                    <article className={`share-list-item ${expired ? "expired" : ""}`} key={share.id}>
                      <span className={`share-kind-icon ${share.share_type}`}>
                        {typeIcon(share.share_type, 19)}
                      </span>
                      <div className="share-list-content">
                        <div>
                          <span className="share-kind-label">{typeLabel(share.share_type)}</span>
                          {expired && <span className="share-expired-label">已过期</span>}
                        </div>
                        <strong title={share.title}>{share.title}</strong>
                        <p>
                          {share.share_type === "text"
                            ? share.text_content
                            : share.share_type === "link"
                              ? share.link_url
                              : share.file
                                ? `${share.file.name} · ${formatBytes(share.file.size)}`
                                : "文件已不存在"}
                        </p>
                        <div className="share-list-meta">
                          <span><Eye size={13} /> {share.view_count} 次查看</span>
                          <span>
                            <Clock3 size={13} />
                            {share.expires_at ? `${formatDate(share.expires_at)} 到期` : "永久有效"}
                          </span>
                        </div>
                      </div>
                      <div className="share-list-actions">
                        <button title="复制链接" onClick={() => void copyText(url)}>
                          <Copy size={16} />
                        </button>
                        <button title="打开分享" onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>
                          <ExternalLink size={16} />
                        </button>
                        <button
                          className="danger-text"
                          title="取消分享"
                          disabled={deletingId === share.id}
                          onClick={() => {
                            if (!window.confirm(`确定取消“${share.title}”的分享吗？`)) return;
                            setDeletingId(share.id);
                            void deleteShare(share.id)
                              .then(load)
                              .catch((deleteError) => setError(messageFrom(deleteError)))
                              .finally(() => setDeletingId(null));
                          }}
                        >
                          {deletingId === share.id
                            ? <LoaderCircle className="spin" size={16} />
                            : <Trash2 size={16} />}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
