import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  Check,
  Clipboard,
  Cloud,
  Copy,
  LoaderCircle,
  LogOut,
  Monitor,
  RefreshCw,
  Send,
  Smartphone,
  Trash2,
} from "lucide-react";
import { formatDate, initials } from "./lib/format";
import { quickTransition } from "./lib/motion";
import {
  createQuickText,
  deleteQuickText,
  listQuickTexts,
  subscribeToQuickTexts,
} from "./lib/quickTexts";
import { supabase } from "./lib/supabase";
import type { QuickText } from "./types";

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export default function QuickTextCenter(props: {
  session: Session;
  onBack: () => void;
}) {
  const userId = props.session.user.id;
  const [content, setContent] = useState("");
  const [items, setItems] = useState<QuickText[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      setItems(await listQuickTexts(userId));
    } catch (loadError) {
      setError(messageFrom(loadError));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const channel = subscribeToQuickTexts(userId, () => {
      void load(true);
    });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, userId]);

  useEffect(() => {
    const onFocus = () => void load(true);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const item = await createQuickText(userId, content);
      setItems((current) => [item, ...current.filter((entry) => entry.id !== item.id)]);
      setContent("");
      setNotice("已同步，其他已登录设备会自动出现这段文字。");
    } catch (saveError) {
      setError(messageFrom(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function handleCopy(item: QuickText) {
    setError(null);
    try {
      await copyText(item.content);
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId((current) => current === item.id ? null : current), 1800);
    } catch (copyError) {
      setError(messageFrom(copyError));
    }
  }

  return (
    <div className="quick-text-shell">
      <header className="quick-text-topbar">
        <div className="brand-lockup">
          <span className="brand-mark"><Cloud size={23} /></span>
          <span>小盘</span>
          <span className="quick-text-brand-badge">文字快传</span>
        </div>
        <div className="quick-text-account">
          <span className="avatar compact">{initials(props.session.user.email)}</span>
          <span>{props.session.user.email}</span>
          <button className="icon-button" title="退出登录" aria-label="退出登录" onClick={() => void supabase.auth.signOut()}>
            <LogOut size={17} />
          </button>
        </div>
      </header>

      <main className="quick-text-main">
        <div className="quick-text-heading">
          <div>
            <span className="eyebrow dark"><Clipboard size={15} /> 同一账号，跨设备同步</span>
            <h1>文字快传</h1>
            <p>手机粘贴并保存，电脑会自动收到，点一下即可复制。</p>
          </div>
          <button className="secondary-button" onClick={props.onBack}>
            <ArrowLeft size={17} /> 返回我的云盘
          </button>
        </div>

        <div className="quick-text-flow" aria-label="使用方法">
          <span><Smartphone size={17} /> 手机粘贴文字</span>
          <i aria-hidden="true">→</i>
          <span><Send size={17} /> 保存到账号</span>
          <i aria-hidden="true">→</i>
          <span><Monitor size={17} /> 电脑一键复制</span>
        </div>

        <div className="quick-text-grid">
          <section className="quick-text-compose">
            <div className="quick-text-panel-head">
              <div>
                <h2>粘贴文字</h2>
                <p>仅同一账号可见，不会自动公开分享。</p>
              </div>
            </div>
            <form onSubmit={submit} aria-busy={saving}>
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                aria-label="要跨设备同步的文字"
                maxLength={100000}
                placeholder="在这里长按粘贴文字、网址、验证码、地址或一小段笔记……"
                autoFocus
                required
              />
              <div className="quick-text-count">
                <span>{content.length.toLocaleString()} / 100,000 字</span>
                <span>内容通过账号安全同步</span>
              </div>
              {error && <div className="quick-text-message error" role="alert" aria-live="assertive">{error}</div>}
              {notice && <div className="quick-text-message success" role="status" aria-live="polite"><Check size={16} />{notice}</div>}
              <button className="primary-button quick-text-save" disabled={saving || !content.trim()}>
                {saving ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}
                保存并同步
              </button>
            </form>
          </section>

          <section className="quick-text-history">
            <div className="quick-text-panel-head">
              <div>
                <h2>最近文字</h2>
                <p>{items.length} 条记录，最新内容排在最上面。</p>
              </div>
              <button className="icon-button" onClick={() => void load()} disabled={loading} title="刷新" aria-label="刷新文字记录">
                <RefreshCw className={loading ? "spin" : ""} size={17} />
              </button>
            </div>

            {loading && items.length === 0 ? (
              <div className="quick-text-empty" role="status" aria-live="polite">
                <LoaderCircle className="spin" size={24} />
                <span>正在同步文字</span>
              </div>
            ) : items.length === 0 ? (
              <div className="quick-text-empty">
                <Clipboard size={28} />
                <strong>还没有文字</strong>
                <span>在手机上粘贴并保存第一段文字。</span>
              </div>
            ) : (
              <div className="quick-text-list">
                <AnimatePresence initial={false}>
                {items.map((item, index) => (
                  <motion.article
                    className="quick-text-item"
                    key={item.id}
                    layout="position"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: 8 }}
                    transition={quickTransition}
                  >
                    <div className="quick-text-item-meta">
                      <span>{index === 0 ? "最新" : "文字"}</span>
                      <time dateTime={item.created_at}>{formatDate(item.created_at)}</time>
                    </div>
                    <pre>{item.content}</pre>
                    <div className="quick-text-actions">
                      <button
                        className="primary-button"
                        onClick={() => void handleCopy(item)}
                        aria-live="polite"
                      >
                        {copiedId === item.id ? <Check size={16} /> : <Copy size={16} />}
                        {copiedId === item.id ? "已复制" : "复制文字"}
                      </button>
                      <button
                        className="quick-text-delete"
                        title="删除文字"
                        aria-label="删除这段文字"
                        disabled={deletingId === item.id}
                        onClick={() => {
                          if (!window.confirm("确定删除这段文字吗？")) return;
                          setDeletingId(item.id);
                          void deleteQuickText(item.id)
                            .then(() => setItems((current) => current.filter((entry) => entry.id !== item.id)))
                            .catch((deleteError) => setError(messageFrom(deleteError)))
                            .finally(() => setDeletingId(null));
                        }}
                      >
                        {deletingId === item.id
                          ? <LoaderCircle className="spin" size={16} />
                          : <Trash2 size={16} />}
                      </button>
                    </div>
                  </motion.article>
                ))}
                </AnimatePresence>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
