import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowLeft,
  Cloud,
  File,
  Folder,
  HardDrive,
  LoaderCircle,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { deleteManagedUser, getAdminOverview } from "./lib/admin";
import { formatBytes, formatDate, initials } from "./lib/format";
import { supabase } from "./lib/supabase";
import type { AdminOverview, AdminUserSummary } from "./types";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}

export default function AdminApp(props: {
  session: Session;
  onOpenDrive: () => void;
}) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<AdminUserSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await getAdminOverview(props.session));
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [props.session]);

  useEffect(() => {
    void load();
  }, [load]);

  const users = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return overview?.users ?? [];
    return (overview?.users ?? []).filter((user) =>
      user.email.toLocaleLowerCase().includes(normalized),
    );
  }, [overview?.users, query]);

  const cards = overview
    ? [
        { label: "用户总数", value: String(overview.totals.users), icon: <Users size={20} /> },
        { label: "文件总数", value: String(overview.totals.files), icon: <File size={20} /> },
        { label: "文件夹", value: String(overview.totals.folders), icon: <Folder size={20} /> },
        { label: "已用容量", value: formatBytes(overview.totals.usedBytes), icon: <HardDrive size={20} /> },
      ]
    : [];

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <div className="brand-lockup">
          <span className="brand-mark"><Cloud size={23} /></span>
          <span>小盘</span>
          <span className="admin-brand-badge">管理后台</span>
        </div>
        <div className="admin-account">
          <span className="avatar compact">{initials(props.session.user.email)}</span>
          <span>
            <strong>管理员账户</strong>
            <small>超级管理员</small>
          </span>
          <button className="icon-button" title="退出登录" onClick={() => void supabase.auth.signOut()}>
            <LogOut size={17} />
          </button>
        </div>
      </header>

      <main className="admin-main">
        <div className="admin-heading">
          <div>
            <span className="eyebrow dark"><ShieldCheck size={15} /> 安全管理中心</span>
            <h1>后台管理</h1>
            <p>查看全站容量和用户使用情况，并安全清理用户数据。</p>
          </div>
          <div className="admin-heading-actions">
            <button className="secondary-button" onClick={props.onOpenDrive}>
              <ArrowLeft size={17} /> 返回我的云盘
            </button>
            <button className="primary-button" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={loading ? "spin" : ""} size={17} /> 刷新数据
            </button>
          </div>
        </div>

        {error && (
          <div className="admin-error">
            <span>{error}</span>
            <button onClick={() => setError(null)}><X size={16} /></button>
          </div>
        )}

        {loading && !overview ? (
          <div className="admin-loading">
            <LoaderCircle className="spin" size={27} />
            <strong>正在读取后台数据</strong>
          </div>
        ) : (
          <>
            <section className="admin-stats" aria-label="全站统计">
              {cards.map((card) => (
                <article key={card.label}>
                  <span className="admin-stat-icon">{card.icon}</span>
                  <div><small>{card.label}</small><strong>{card.value}</strong></div>
                </article>
              ))}
            </section>

            <section className="admin-users-panel">
              <div className="admin-panel-head">
                <div>
                  <h2>用户管理</h2>
                  <p>{overview?.totals.users ?? 0} 个账户，删除后将同步清理其网盘文件。</p>
                </div>
                <label className="admin-search">
                  <Search size={17} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索用户邮箱"
                  />
                </label>
              </div>

              <div className="admin-user-table">
                <div className="admin-user-row admin-user-head">
                  <span>用户</span><span>文件</span><span>容量</span><span>最近登录</span><span />
                </div>
                {users.length === 0 ? (
                  <div className="admin-empty"><UserRound size={26} /><span>没有匹配的用户</span></div>
                ) : users.map((user) => (
                  <div className="admin-user-row" key={user.id}>
                    <div className="admin-user-cell">
                      <span className="avatar">{initials(user.email)}</span>
                      <span><strong>{user.email}</strong><small>注册于 {formatDate(user.createdAt)}</small></span>
                      {user.id === overview?.currentAdminId && <em>当前管理员</em>}
                    </div>
                    <span>{user.fileCount} 文件 · {user.folderCount} 文件夹</span>
                    <strong>{formatBytes(user.usedBytes)}</strong>
                    <span>{user.lastSignInAt ? formatDate(user.lastSignInAt) : "从未登录"}</span>
                    <button
                      className="admin-delete-button"
                      disabled={user.id === overview?.currentAdminId}
                      title={user.id === overview?.currentAdminId ? "不能删除当前管理员" : "删除用户"}
                      onClick={() => setTarget(user)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>

      {target && (
        <div className="modal-backdrop" onMouseDown={() => !deleting && setTarget(null)}>
          <section className="modal" onMouseDown={(event) => event.stopPropagation()}>
            <header><h2>删除用户？</h2><button disabled={deleting} onClick={() => setTarget(null)}><X size={18} /></button></header>
            <div className="confirm-copy">
              <span className="danger-icon"><Trash2 size={21} /></span>
              <p>
                将永久删除 <strong>{target.email}</strong> 的账户、文件记录和 Storage 中的对象。此操作无法撤销。
              </p>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" disabled={deleting} onClick={() => setTarget(null)}>取消</button>
              <button
                className="danger-button"
                disabled={deleting}
                onClick={() => {
                  setDeleting(true);
                  setError(null);
                  void deleteManagedUser(props.session, target.id)
                    .then(async () => {
                      setTarget(null);
                      await load();
                    })
                    .catch((deleteError) => setError(errorMessage(deleteError)))
                    .finally(() => setDeleting(false));
                }}
              >
                {deleting && <LoaderCircle className="spin" size={16} />}
                永久删除
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
