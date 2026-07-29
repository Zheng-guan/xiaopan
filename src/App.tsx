import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Archive,
  ArrowDownAZ,
  ArrowUpAZ,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clipboard,
  Cloud,
  Download,
  File,
  FileArchive,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  FolderPlus,
  Gauge,
  Grid2X2,
  HardDrive,
  Image,
  List,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  MoreHorizontal,
  Move,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Share2,
  ShieldCheck,
  Trash2,
  UploadCloud,
  Video,
  X,
} from "lucide-react";
import AdminApp from "./AdminApp";
import PublicShareView from "./PublicShareView";
import QuickTextCenter from "./QuickTextCenter";
import ShareCenter from "./ShareCenter";
import ThemeToggle from "./ThemeToggle";
import { checkAdmin } from "./lib/admin";
import {
  createFolder,
  deleteDriveItems,
  getDriveQuota,
  getDriveUsage,
  listAllFolders,
  listDriveItems,
  moveDriveItems,
  renameDriveItem,
  signedDownloadUrl,
  sortDriveItems,
} from "./lib/drive";
import {
  formatBytes,
  formatDate,
  formatQuotaBytes,
  formatSpeed,
  initials,
} from "./lib/format";
import {
  isSupabaseConfigured,
  maxFileSizeBytes,
  supabase,
} from "./lib/supabase";
import {
  createResumableUpload,
  type ResumableUpload,
} from "./lib/upload";
import type {
  CategoryFilter,
  DriveItem,
  DriveQuota,
  DriveUsage,
  SortDirection,
  SortKey,
  UploadTask,
  ViewMode,
} from "./types";

const emptyUsage: DriveUsage = {
  used_bytes: 0,
  file_count: 0,
  folder_count: 0,
};

type DropTargetKey = number | "root" | null;

interface TouchDragPreview {
  x: number;
  y: number;
  label: string;
  count: number;
}

interface TouchDragSession {
  pointerId: number;
  startX: number;
  startY: number;
  timer: number | null;
  active: boolean;
  targets: DriveItem[];
  source: HTMLElement;
}

const administratorEmail =
  import.meta.env.VITE_ADMIN_EMAIL?.trim() || "raimanncostigan@gmail.com";

function publicShareTokenFromPath() {
  return window.location.pathname.match(
    /^\/s\/([0-9a-f-]{36})\/?$/i,
  )?.[1] ?? null;
}

function messageFrom(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String(error.message);
  }
  return "操作失败，请稍后重试";
}

function fileIcon(item: DriveItem, size = 20) {
  if (item.kind === "folder") return <Folder size={size} fill="currentColor" />;
  const mime = item.mime_type ?? "";
  if (mime.startsWith("image/")) return <FileImage size={size} />;
  if (mime.startsWith("video/")) return <FileVideo size={size} />;
  if (mime.includes("zip") || mime.includes("rar") || mime.includes("archive")) {
    return <FileArchive size={size} />;
  }
  if (
    mime.startsWith("text/") ||
    mime.includes("pdf") ||
    mime.includes("document") ||
    mime.includes("sheet")
  ) {
    return <FileText size={size} />;
  }
  return <File size={size} />;
}

function uniqueDisplayName(file: File, existing: Set<string>) {
  if (!existing.has(file.name.toLocaleLowerCase())) {
    existing.add(file.name.toLocaleLowerCase());
    return file.name;
  }
  const dot = file.name.lastIndexOf(".");
  const base = dot > 0 ? file.name.slice(0, dot) : file.name;
  const extension = dot > 0 ? file.name.slice(dot) : "";
  let index = 2;
  while (existing.has(`${base} (${index})${extension}`.toLocaleLowerCase())) index += 1;
  const result = `${base} (${index})${extension}`;
  existing.add(result.toLocaleLowerCase());
  return result;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const publicShareToken = publicShareTokenFromPath();

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  let content: ReactNode;

  if (publicShareToken) {
    content = <PublicShareView token={publicShareToken} />;
  } else if (!ready) {
    content = (
      <div className="app-loading">
        <div className="brand-mark">
          <Cloud size={25} strokeWidth={2.3} />
        </div>
        <LoaderCircle className="spin" size={22} />
      </div>
    );
  } else {
    content = session ? <AuthenticatedView session={session} /> : <AuthView />;
  }

  return (
    <>
      {content}
      <ThemeToggle />
    </>
  );
}

function AuthenticatedView({ session }: { session: Session }) {
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [view, setView] = useState<"drive" | "admin" | "shares" | "quick-text">(() => {
    const shouldOpenAdmin =
      window.sessionStorage.getItem("xiaopan:open-admin") === "1";
    window.sessionStorage.removeItem("xiaopan:open-admin");
    return shouldOpenAdmin ? "admin" : "drive";
  });
  const [shareFile, setShareFile] = useState<DriveItem | null>(null);

  useEffect(() => {
    let active = true;
    void checkAdmin(session)
      .then(() => {
        if (!active) return;
        setIsAdmin(true);
      })
      .catch(() => {
        if (active) setIsAdmin(false);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [session]);

  if (checking) {
    return (
      <div className="app-loading">
        <div className="brand-mark"><Cloud size={25} /></div>
        <LoaderCircle className="spin" size={22} />
      </div>
    );
  }

  if (isAdmin && view === "admin") {
    return <AdminApp session={session} onOpenDrive={() => setView("drive")} />;
  }

  if (view === "shares") {
    return (
      <ShareCenter
        session={session}
        initialFile={shareFile}
        onInitialFileHandled={() => setShareFile(null)}
        onBack={() => setView("drive")}
      />
    );
  }

  if (view === "quick-text") {
    return (
      <QuickTextCenter
        session={session}
        onBack={() => setView("drive")}
      />
    );
  }

  return (
    <DriveApp
      session={session}
      isAdmin={isAdmin}
      onOpenAdmin={() => setView("admin")}
      onOpenQuickText={() => setView("quick-text")}
      onOpenShares={(file) => {
        setShareFile(file);
        setView("shares");
      }}
    />
  );
}

function AuthView() {
  const [mode, setMode] = useState<"signin" | "signup" | "admin">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!isSupabaseConfigured) {
      setError("请先按 README 配置 Supabase 环境变量");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "admin") {
        window.sessionStorage.setItem("xiaopan:open-admin", "1");
        const { error: adminSignInError } = await supabase.auth.signInWithPassword({
          email: administratorEmail,
          password,
        });
        if (adminSignInError) {
          window.sessionStorage.removeItem("xiaopan:open-admin");
          throw adminSignInError;
        }
      } else if (mode === "signin") {
        window.sessionStorage.removeItem("xiaopan:open-admin");
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: name.trim() },
            emailRedirectTo: window.location.origin,
          },
        });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setNotice("注册成功！请查看邮箱并完成验证，然后返回登录。");
          setMode("signin");
        }
      }
    } catch (submitError) {
      setError(messageFrom(submitError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-story">
        <div className="auth-glow auth-glow-one" />
        <div className="auth-glow auth-glow-two" />
        <div className="story-inner">
          <div className="brand-lockup light">
            <span className="brand-mark">
              <Cloud size={25} strokeWidth={2.3} />
            </span>
            <span>小盘</span>
          </div>
          <div className="story-copy">
            <span className="eyebrow">
              <ShieldCheck size={16} />
              私密 · 可靠 · 随处可用
            </span>
            <h1>你的文件，应该有一处安静的归宿。</h1>
            <p>
              大文件断点续传，设备间安全访问。清爽的界面，只留下真正重要的内容。
            </p>
          </div>
          <div className="story-card">
            <div className="story-card-icon">
              <UploadCloud size={22} />
            </div>
            <div>
              <strong>为不稳定网络而生</strong>
              <span>6 MB 智能分片 · 自动重试 · 随时继续</span>
            </div>
            <Gauge size={22} />
          </div>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-mobile-brand brand-lockup">
          <span className="brand-mark">
            <Cloud size={22} />
          </span>
          <span>小盘</span>
        </div>
        <div className="auth-card">
          <header>
            <span className="eyebrow dark">欢迎来到小盘</span>
            <h2>
              {mode === "signin"
                ? "登录你的云空间"
                : mode === "signup"
                  ? "创建个人云空间"
                  : "管理员密码登录"}
            </h2>
            <p>
              {mode === "signin"
                ? "继续整理、上传和下载你的文件。"
                : mode === "signup"
                  ? "免费开始，文件默认仅你自己可见。"
                  : "只需输入管理员密码，即可进入安全管理后台。"}
            </p>
          </header>

          {!isSupabaseConfigured && (
            <div className="inline-alert warning">
              <CircleAlert size={17} />
              当前为界面预览。连接 Supabase 后即可注册登录。
            </div>
          )}
          {error && (
            <div className="inline-alert error">
              <CircleAlert size={17} />
              {error}
            </div>
          )}
          {notice && (
            <div className="inline-alert success">
              <Check size={17} />
              {notice}
            </div>
          )}

          <form onSubmit={submit} className="auth-form">
            {mode === "signup" && (
              <label>
                <span>你的称呼</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例如：小林"
                  autoComplete="name"
                  required
                />
              </label>
            )}
            {mode !== "admin" && (
              <label>
                <span>邮箱</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                  autoComplete="email"
                  required
                />
              </label>
            )}
            <label>
              <span>{mode === "admin" ? "管理员密码" : "密码"}</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={mode === "admin" ? "请输入管理员密码" : "至少 6 位"}
                minLength={6}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
              />
            </label>
            <button className="primary-button auth-submit" disabled={busy}>
              {busy && <LoaderCircle className="spin" size={17} />}
              {mode === "signin"
                ? "进入云空间"
                : mode === "signup"
                  ? "创建账户"
                  : "进入管理后台"}
            </button>
          </form>

          {mode === "admin" ? (
            <p className="auth-switch">
              <button type="button" onClick={() => setMode("signin")}>返回普通用户登录</button>
            </p>
          ) : (
            <>
              <p className="auth-switch">
                {mode === "signin" ? "还没有账户？" : "已经有账户？"}
                <button
                  type="button"
                  onClick={() => {
                    setMode(mode === "signin" ? "signup" : "signin");
                    setError(null);
                    setNotice(null);
                  }}
                >
                  {mode === "signin" ? "立即注册" : "返回登录"}
                </button>
              </p>
              <button
                type="button"
                className="admin-entry-button"
                onClick={() => {
                  setMode("admin");
                  setError(null);
                  setNotice(null);
                }}
              >
                <ShieldCheck size={16} />
                管理员入口
              </button>
            </>
          )}
        </div>
        <footer className="auth-support">
          <span>使用中遇到问题？</span>
          <a href={`mailto:${administratorEmail}`}>问题申报邮箱：{administratorEmail}</a>
        </footer>
      </section>
    </main>
  );
}

function DriveApp({
  session,
  isAdmin,
  onOpenAdmin,
  onOpenQuickText,
  onOpenShares,
}: {
  session: Session;
  isAdmin: boolean;
  onOpenAdmin: () => void;
  onOpenQuickText: () => void;
  onOpenShares: (file: DriveItem | null) => void;
}) {
  const userId = session.user.id;
  const [items, setItems] = useState<DriveItem[]>([]);
  const [usage, setUsage] = useState<DriveUsage>(emptyUsage);
  const [quota, setQuota] = useState<DriveQuota | null>(null);
  const [path, setPath] = useState<DriveItem[]>([]);
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [draggedIds, setDraggedIds] = useState<Set<number>>(new Set());
  const [dropTarget, setDropTarget] = useState<DropTargetKey>(null);
  const [touchDragPreview, setTouchDragPreview] =
    useState<TouchDragPreview | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modal, setModal] = useState<
    | { type: "folder" }
    | { type: "rename"; item: DriveItem }
    | { type: "move"; items: DriveItem[] }
    | { type: "delete"; items: DriveItem[] }
    | null
  >(null);
  const [folders, setFolders] = useState<DriveItem[]>([]);
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [uploadPanelOpen, setUploadPanelOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploads = useRef(new Map<string, ResumableUpload>());
  const dragTargets = useRef<DriveItem[]>([]);
  const dropTargetRef = useRef<DropTargetKey>(null);
  const touchDragSession = useRef<TouchDragSession | null>(null);
  const moveInFlight = useRef(false);
  const speedSamples = useRef(
    new Map<string, { bytes: number; at: number; smoothed: number }>(),
  );
  const refreshRef = useRef<() => Promise<void>>(async () => {});

  const currentFolder = path.at(-1) ?? null;
  const selectedItems = items.filter((item) => selected.has(item.id));
  const visibleItems = useMemo(
    () => sortDriveItems(items, sortKey, sortDirection),
    [items, sortKey, sortDirection],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextItems, nextUsage, nextQuota] = await Promise.all([
        listDriveItems({
          userId,
          parentId: currentFolder?.id ?? null,
          search: query,
          category,
        }),
        getDriveUsage(),
        getDriveQuota(),
      ]);
      setItems(nextItems);
      setUsage(nextUsage);
      setQuota(nextQuota);
      setSelected(new Set());
    } catch (loadError) {
      setToast(messageFrom(loadError));
    } finally {
      setLoading(false);
    }
  }, [category, currentFolder?.id, query, userId]);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    document.body.classList.toggle("touch-drag-active", Boolean(touchDragPreview));
    return () => document.body.classList.remove("touch-drag-active");
  }, [touchDragPreview]);

  useEffect(
    () => () => {
      const session = touchDragSession.current;
      if (session?.timer !== null && session?.timer !== undefined) {
        window.clearTimeout(session.timer);
      }
    },
    [],
  );

  function chooseCategory(next: CategoryFilter) {
    setCategory(next);
    setQuery("");
    setSearch("");
    setPath([]);
    setSidebarOpen(false);
  }

  function openFolder(item: DriveItem) {
    setCategory("all");
    setQuery("");
    setSearch("");
    setPath((current) => [...current, item]);
  }

  async function startFiles(fileList: FileList | File[]) {
    const incoming = Array.from(fileList);
    if (!incoming.length) return;
    if (!quota) {
      setToast("正在读取可用存储空间，请稍后再试");
      return;
    }
    const uploadLimit = Math.min(maxFileSizeBytes, quota.remaining_bytes);
    const tooLarge = incoming.find((file) => file.size > uploadLimit);
    if (tooLarge) {
      setToast(`${tooLarge.name} 超过当前可用空间，无法上传`);
      return;
    }
    const totalSize = incoming.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > quota.remaining_bytes) {
      setToast(
        `所选文件共 ${formatQuotaBytes(totalSize)}，当前仅剩 ${formatQuotaBytes(quota.remaining_bytes)}`,
      );
      return;
    }

    const names = new Set(items.map((item) => item.name.toLocaleLowerCase()));
    const newTasks = incoming.map((file) => ({
      id: crypto.randomUUID(),
      file,
      displayName: uniqueDisplayName(file, names),
      status: "queued" as const,
      uploaded: 0,
      total: file.size,
      speed: 0,
    }));
    setTasks((current) => [...newTasks, ...current]);
    setUploadPanelOpen(true);

    for (const task of newTasks) {
      void prepareAndStart(task);
    }
  }

  async function prepareAndStart(task: UploadTask) {
    try {
      const upload = await createResumableUpload({
        file: task.file,
        displayName: task.displayName,
        userId,
        parentId: currentFolder?.id ?? null,
        onProgress: (uploaded, total) => {
          const now = performance.now();
          const previous = speedSamples.current.get(task.id) ?? {
            bytes: uploaded,
            at: now,
            smoothed: 0,
          };
          const elapsed = Math.max((now - previous.at) / 1000, 0.05);
          const instant = Math.max(0, uploaded - previous.bytes) / elapsed;
          const smoothed =
            previous.smoothed > 0
              ? previous.smoothed * 0.7 + instant * 0.3
              : instant;
          speedSamples.current.set(task.id, {
            bytes: uploaded,
            at: now,
            smoothed,
          });
          setTasks((current) =>
            current.map((item) =>
              item.id === task.id
                ? {
                    ...item,
                    uploaded,
                    total,
                    speed: smoothed,
                    status: "uploading",
                    error: undefined,
                  }
                : item,
            ),
          );
        },
        onSuccess: () => {
          setTasks((current) =>
            current.map((item) =>
              item.id === task.id
                ? {
                    ...item,
                    status: "complete",
                    uploaded: item.total,
                    speed: 0,
                  }
                : item,
            ),
          );
          uploads.current.delete(task.id);
          speedSamples.current.delete(task.id);
          void refreshRef.current();
        },
        onError: (uploadError) => {
          setTasks((current) =>
            current.map((item) =>
              item.id === task.id
                ? {
                    ...item,
                    status: "error",
                    error: messageFrom(uploadError),
                    speed: 0,
                  }
                : item,
            ),
          );
        },
      });
      uploads.current.set(task.id, upload);
      setTasks((current) =>
        current.map((item) =>
          item.id === task.id ? { ...item, status: "uploading" } : item,
        ),
      );
      upload.start();
    } catch (uploadError) {
      setTasks((current) =>
        current.map((item) =>
          item.id === task.id
            ? { ...item, status: "error", error: messageFrom(uploadError) }
            : item,
        ),
      );
    }
  }

  async function pauseTask(id: string) {
    await uploads.current.get(id)?.abort();
    setTasks((current) =>
      current.map((task) =>
        task.id === id ? { ...task, status: "paused", speed: 0 } : task,
      ),
    );
  }

  function resumeTask(id: string) {
    uploads.current.get(id)?.start();
    setTasks((current) =>
      current.map((task) =>
        task.id === id
          ? { ...task, status: "uploading", error: undefined }
          : task,
      ),
    );
  }

  async function download(item: DriveItem) {
    try {
      const url = await signedDownloadUrl(item, session.access_token);
      const usesCoarsePointer =
        window.matchMedia?.("(pointer: coarse)").matches ||
        window.navigator.maxTouchPoints > 0;
      if (usesCoarsePointer) {
        window.location.assign(url);
        return;
      }
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.name;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (downloadError) {
      setToast(messageFrom(downloadError));
    }
  }

  function toggleSelection(id: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected((current) =>
      current.size === visibleItems.length
        ? new Set()
        : new Set(visibleItems.map((item) => item.id)),
    );
  }

  async function openMoveDialog(targets: DriveItem[]) {
    try {
      setFolders(await listAllFolders(userId));
      setModal({ type: "move", items: targets });
    } catch (folderError) {
      setToast(messageFrom(folderError));
    }
  }

  function handleUploadDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    void startFiles(event.dataTransfer.files);
  }

  function targetsForDrag(item: DriveItem) {
    return selected.has(item.id) ? selectedItems : [item];
  }

  function setActiveDropTarget(target: DropTargetKey) {
    dropTargetRef.current = target;
    setDropTarget((current) => (current === target ? current : target));
  }

  function clearDragVisuals() {
    dragTargets.current = [];
    setDraggedIds(new Set());
    setActiveDropTarget(null);
    setTouchDragPreview(null);
  }

  async function moveDroppedItems(
    targets: DriveItem[],
    parentId: number | null,
    targetLabel?: string,
  ) {
    if (!targets.length || moveInFlight.current) return;
    if (targets.every((item) => item.parent_id === parentId)) {
      setToast("这些内容已经在目标文件夹中");
      return;
    }

    moveInFlight.current = true;
    try {
      const allFolders = await listAllFolders(userId);
      setFolders(allFolders);

      if (parentId !== null) {
        const folderById = new Map(allFolders.map((folder) => [folder.id, folder]));
        if (!folderById.has(parentId)) throw new Error("目标文件夹不存在");

        const movedFolderIds = new Set(
          targets
            .filter((item) => item.kind === "folder")
            .map((item) => item.id),
        );
        const visited = new Set<number>();
        let cursor: number | null = parentId;
        while (cursor !== null && !visited.has(cursor)) {
          if (movedFolderIds.has(cursor)) {
            throw new Error("不能把文件夹移动到自身或其子文件夹中");
          }
          visited.add(cursor);
          cursor = folderById.get(cursor)?.parent_id ?? null;
        }
      }

      await moveDriveItems(
        targets.map((item) => item.id),
        parentId,
      );
      setSelected(new Set());
      setToast(
        `已移动 ${targets.length} 项到${targetLabel ? `“${targetLabel}”` : "我的云盘"}`,
      );
      await refresh();
    } catch (moveError) {
      setToast(messageFrom(moveError));
    } finally {
      moveInFlight.current = false;
    }
  }

  function beginDesktopDrag(event: DragEvent<HTMLElement>, item: DriveItem) {
    const origin = event.target as HTMLElement;
    if (
      origin.closest(
        "input, label, .row-actions, .card-actions, .card-check",
      )
    ) {
      event.preventDefault();
      return;
    }

    const targets = targetsForDrag(item);
    dragTargets.current = targets;
    setDraggedIds(new Set(targets.map((target) => target.id)));
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      "application/x-xiaopan-items",
      targets.map((target) => target.id).join(","),
    );
  }

  function finishDesktopDrag() {
    clearDragVisuals();
  }

  function handleMoveDragOver(
    event: DragEvent<HTMLElement>,
    target: Exclude<DropTargetKey, null>,
  ) {
    if (!dragTargets.current.length) return;
    if (
      target !== "root" &&
      dragTargets.current.some(
        (item) => item.kind === "folder" && item.id === target,
      )
    ) {
      if (dropTargetRef.current === target) setActiveDropTarget(null);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setActiveDropTarget(target);
  }

  function handleMoveDragLeave(
    event: DragEvent<HTMLElement>,
    target: Exclude<DropTargetKey, null>,
  ) {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    if (dropTargetRef.current === target) setActiveDropTarget(null);
  }

  function handleMoveDrop(
    event: DragEvent<HTMLElement>,
    target: Exclude<DropTargetKey, null>,
    targetLabel?: string,
  ) {
    if (!dragTargets.current.length) return;
    event.preventDefault();
    event.stopPropagation();
    const targets = [...dragTargets.current];
    clearDragVisuals();
    void moveDroppedItems(
      targets,
      target === "root" ? null : target,
      targetLabel,
    );
  }

  function cancelPendingTouchDrag() {
    const session = touchDragSession.current;
    if (session?.timer !== null && session?.timer !== undefined) {
      window.clearTimeout(session.timer);
    }
    touchDragSession.current = null;
  }

  function beginTouchDrag(
    event: ReactPointerEvent<HTMLElement>,
    item: DriveItem,
  ) {
    if (event.pointerType !== "touch") return;
    const origin = event.target as HTMLElement;
    if (
      origin.closest(
        "input, label, .row-actions, .card-actions, .card-check",
      )
    ) {
      return;
    }

    cancelPendingTouchDrag();
    const targets = targetsForDrag(item);
    const session: TouchDragSession = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      timer: null,
      active: false,
      targets,
      source: event.currentTarget,
    };
    session.timer = window.setTimeout(() => {
      if (touchDragSession.current !== session) return;
      session.active = true;
      session.timer = null;
      try {
        session.source.setPointerCapture(session.pointerId);
      } catch {
        // Pointer capture is an enhancement; the long-press drag still works without it.
      }
      dragTargets.current = targets;
      setDraggedIds(new Set(targets.map((target) => target.id)));
      setTouchDragPreview({
        x: session.startX,
        y: session.startY,
        label: targets.length === 1 ? targets[0].name : `${targets.length} 项内容`,
        count: targets.length,
      });
      window.navigator.vibrate?.(18);
    }, 420);
    touchDragSession.current = session;
  }

  function moveTouchDrag(event: ReactPointerEvent<HTMLElement>) {
    const session = touchDragSession.current;
    if (!session || event.pointerId !== session.pointerId) return;

    const distance = Math.hypot(
      event.clientX - session.startX,
      event.clientY - session.startY,
    );
    if (!session.active) {
      if (distance > 10) cancelPendingTouchDrag();
      return;
    }

    event.preventDefault();
    setTouchDragPreview((current) =>
      current ? { ...current, x: event.clientX, y: event.clientY } : current,
    );

    const element = document.elementFromPoint(event.clientX, event.clientY);
    const dropElement = element?.closest<HTMLElement>("[data-drop-folder-id]");
    const value = dropElement?.dataset.dropFolderId;
    let target: DropTargetKey = null;
    if (value === "root") {
      target = "root";
    } else if (value && Number.isSafeInteger(Number(value))) {
      const numericTarget = Number(value);
      const movingItself = session.targets.some(
        (item) => item.kind === "folder" && item.id === numericTarget,
      );
      if (!movingItself) target = numericTarget;
    }
    setActiveDropTarget(target);
  }

  function finishTouchDrag(event: ReactPointerEvent<HTMLElement>) {
    const session = touchDragSession.current;
    if (!session || event.pointerId !== session.pointerId) return;
    if (session.timer !== null) window.clearTimeout(session.timer);
    touchDragSession.current = null;

    if (!session.active) return;
    event.preventDefault();
    const target = dropTargetRef.current;
    const targets = [...session.targets];
    const targetLabel =
      target === "root"
        ? undefined
        : target === null
          ? undefined
          : items.find((item) => item.id === target)?.name ??
            path.find((item) => item.id === target)?.name;
    clearDragVisuals();
    if (target === null) {
      setToast("请把内容拖到文件夹或“我的云盘”上");
      return;
    }
    void moveDroppedItems(
      targets,
      target === "root" ? null : target,
      targetLabel,
    );
  }

  function cancelTouchDrag(event: ReactPointerEvent<HTMLElement>) {
    const session = touchDragSession.current;
    if (!session || event.pointerId !== session.pointerId) return;
    cancelPendingTouchDrag();
    clearDragVisuals();
  }

  const navItems: {
    id: CategoryFilter;
    label: string;
    icon: ReactNode;
  }[] = [
    { id: "all", label: "全部文件", icon: <HardDrive size={18} /> },
    { id: "recent", label: "最近使用", icon: <RefreshCw size={18} /> },
    { id: "image", label: "图片", icon: <Image size={18} /> },
    { id: "video", label: "视频", icon: <Video size={18} /> },
    { id: "document", label: "文档", icon: <FileText size={18} /> },
  ];

  const accountQuotaBytes = quota?.quota_bytes ?? 0;
  const usagePercent = Math.min(
    100,
    accountQuotaBytes > 0 ? (usage.used_bytes / accountQuotaBytes) * 100 : 0,
  );

  return (
    <div
      className="drive-shell"
      onDragEnter={(event) => {
        if (Array.from(event.dataTransfer.types).includes("Files")) {
          event.preventDefault();
          setDragging(true);
        }
      }}
    >
      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="关闭侧栏"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand-lockup">
          <span className="brand-mark">
            <Cloud size={23} strokeWidth={2.3} />
          </span>
          <span>小盘</span>
        </div>
        <button
          className="upload-button"
          title="上传文件"
          onClick={() => fileInput.current?.click()}
        >
          <Plus size={19} />
          上传文件
        </button>
        <nav className="sidebar-nav">
          <span className="nav-caption">云空间</span>
          {navItems.map((item) => (
            <button
              key={item.id}
              className={category === item.id ? "active" : ""}
              onClick={() => chooseCategory(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.id === "all" && <small>{usage.file_count}</small>}
            </button>
          ))}
          <span className="nav-caption admin-nav-caption">分享</span>
          <button onClick={onOpenQuickText}>
            <Clipboard size={18} />
            <span>文字快传</span>
          </button>
          <button onClick={() => onOpenShares(null)}>
            <Share2 size={18} />
            <span>分享中心</span>
          </button>
          {isAdmin && (
            <>
              <span className="nav-caption admin-nav-caption">管理</span>
              <button onClick={onOpenAdmin}>
                <LayoutDashboard size={18} />
                <span>后台管理</span>
              </button>
            </>
          )}
        </nav>
        <div className="storage-card">
          <div className="storage-card-head">
            <span>
              <Archive size={16} />
              存储空间
            </span>
            <strong>{usagePercent.toFixed(0)}%</strong>
          </div>
          <div className="storage-track">
            <span style={{ width: `${usagePercent}%` }} />
          </div>
          <p>
            已用 {formatBytes(usage.used_bytes)} /{" "}
            {formatQuotaBytes(accountQuotaBytes)}
          </p>
        </div>
        <div className="user-chip">
          <span className="avatar">{initials(session.user.email)}</span>
          <span>
            <strong>
              {String(session.user.user_metadata.display_name || "我的空间")}
            </strong>
            <small>{session.user.email}</small>
          </span>
          <button
            aria-label="退出登录"
            title="退出登录"
            onClick={() => void supabase.auth.signOut()}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      <main className="drive-main">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setSidebarOpen(true)}
            aria-label="打开侧栏"
          >
            <Menu size={20} />
          </button>
          <form
            className="search-box"
            onSubmit={(event) => {
              event.preventDefault();
              setQuery(search.trim());
            }}
          >
            <Search size={18} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索你的文件"
            />
            {search && (
              <button
                type="button"
                aria-label="清除搜索"
                onClick={() => {
                  setSearch("");
                  setQuery("");
                }}
              >
                <X size={15} />
              </button>
            )}
          </form>
          <div className="topbar-actions">
            <span className="secure-badge">
              <ShieldCheck size={15} />
              私密空间
            </span>
            <span className="avatar compact">{initials(session.user.email)}</span>
          </div>
        </header>

        <section className="workspace">
          <div className="workspace-heading">
            <div>
              <div className="breadcrumbs">
                <button
                  className={dropTarget === "root" ? "drop-target" : ""}
                  data-drop-folder-id="root"
                  onClick={() => {
                    setPath([]);
                    setCategory("all");
                    setQuery("");
                    setSearch("");
                  }}
                  onDragOver={(event) => handleMoveDragOver(event, "root")}
                  onDragLeave={(event) => handleMoveDragLeave(event, "root")}
                  onDrop={(event) =>
                    handleMoveDrop(event, "root", "我的云盘")
                  }
                >
                  我的云盘
                </button>
                {path.map((folder, index) => (
                  <span key={folder.id}>
                    <ChevronRight size={14} />
                    <button
                      className={dropTarget === folder.id ? "drop-target" : ""}
                      data-drop-folder-id={folder.id}
                      onClick={() => setPath(path.slice(0, index + 1))}
                      onDragOver={(event) =>
                        handleMoveDragOver(event, folder.id)
                      }
                      onDragLeave={(event) =>
                        handleMoveDragLeave(event, folder.id)
                      }
                      onDrop={(event) =>
                        handleMoveDrop(event, folder.id, folder.name)
                      }
                    >
                      {folder.name}
                    </button>
                  </span>
                ))}
              </div>
              <h1>
                {query
                  ? `“${query}” 的搜索结果`
                  : category === "all"
                    ? currentFolder?.name || "全部文件"
                    : navItems.find((item) => item.id === category)?.label}
              </h1>
              <p>
                {loading
                  ? "正在整理内容…"
                  : `${visibleItems.length} 项 · ${usage.folder_count} 个文件夹`}
              </p>
            </div>
            <div className="workspace-actions">
              <button
                className="secondary-button workspace-share-action"
                onClick={() => onOpenShares(null)}
              >
                <Share2 size={17} />
                分享内容
              </button>
              <button
                className="secondary-button workspace-folder-action"
                onClick={() => setModal({ type: "folder" })}
                aria-label="新建文件夹"
                title="新建文件夹"
              >
                <FolderPlus size={17} />
                新建文件夹
              </button>
              <button
                className="primary-button workspace-upload-action"
                onClick={() => fileInput.current?.click()}
                aria-label="上传文件"
                title="上传文件"
              >
                <UploadCloud size={17} />
                上传
              </button>
            </div>
          </div>

          <div className="toolbar">
            <div className="toolbar-left">
              {selected.size > 0 ? (
                <>
                  <strong>已选择 {selected.size} 项</strong>
                  <button onClick={() => void openMoveDialog(selectedItems)}>
                    <Move size={16} />
                    移动
                  </button>
                  <button
                    className="danger-text"
                    onClick={() =>
                      setModal({ type: "delete", items: selectedItems })
                    }
                  >
                    <Trash2 size={16} />
                    删除
                  </button>
                  <button onClick={() => setSelected(new Set())}>取消</button>
                </>
              ) : (
                <>
                  <span className="toolbar-hint desktop-drag-hint">
                    <UploadCloud size={16} />
                    可将文件拖到此处上传
                  </span>
                  <span className="toolbar-hint mobile-drag-hint">
                    <Move size={16} />
                    长按文件并拖到文件夹即可移动
                  </span>
                </>
              )}
            </div>
            <div className="toolbar-right">
              <button
                className="sort-button"
                onClick={() =>
                  setSortDirection((value) => (value === "asc" ? "desc" : "asc"))
                }
              >
                {sortDirection === "asc" ? (
                  <ArrowDownAZ size={17} />
                ) : (
                  <ArrowUpAZ size={17} />
                )}
              </button>
              <label className="sort-select">
                <select
                  value={sortKey}
                  onChange={(event) => setSortKey(event.target.value as SortKey)}
                >
                  <option value="name">按名称</option>
                  <option value="updated_at">按时间</option>
                  <option value="size">按大小</option>
                </select>
                <ChevronDown size={14} />
              </label>
              <div className="view-switch">
                <button
                  className={viewMode === "list" ? "active" : ""}
                  onClick={() => setViewMode("list")}
                  aria-label="列表视图"
                >
                  <List size={17} />
                </button>
                <button
                  className={viewMode === "grid" ? "active" : ""}
                  onClick={() => setViewMode("grid")}
                  aria-label="网格视图"
                >
                  <Grid2X2 size={17} />
                </button>
              </div>
            </div>
          </div>

          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files) void startFiles(event.target.files);
              event.target.value = "";
            }}
          />

          <div className="file-area">
            {loading ? (
              <div className="empty-state">
                <LoaderCircle className="spin" size={28} />
                <strong>正在加载</strong>
                <span>很快就好</span>
              </div>
            ) : visibleItems.length === 0 ? (
              <div className="empty-state">
                <span className="empty-illustration">
                  <FolderOpen size={31} />
                </span>
                <strong>{query ? "没有找到匹配的内容" : "这里还没有文件"}</strong>
                <span>
                  {query ? "换个关键词试试看" : "拖入文件，或创建第一个文件夹"}
                </span>
                {!query && (
                  <button
                    className="secondary-button"
                    onClick={() => fileInput.current?.click()}
                  >
                    <UploadCloud size={17} />
                    选择文件
                  </button>
                )}
              </div>
            ) : viewMode === "list" ? (
              <div className="file-table">
                <div className="file-row file-head">
                  <label>
                    <input
                      type="checkbox"
                      checked={
                        visibleItems.length > 0 &&
                        selected.size === visibleItems.length
                      }
                      onChange={selectAll}
                    />
                  </label>
                  <span>名称</span>
                  <span>大小</span>
                  <span>修改时间</span>
                  <span />
                </div>
                {visibleItems.map((item) => (
                  <FileRow
                    key={item.id}
                    item={item}
                    checked={selected.has(item.id)}
                    onToggle={() => toggleSelection(item.id)}
                    onOpen={() =>
                      item.kind === "folder" ? openFolder(item) : void download(item)
                    }
                    onDownload={() => void download(item)}
                    onShare={() => onOpenShares(item)}
                    onRename={() => setModal({ type: "rename", item })}
                    onMove={() => void openMoveDialog([item])}
                    onDelete={() => setModal({ type: "delete", items: [item] })}
                    dragging={draggedIds.has(item.id)}
                    dropTarget={item.kind === "folder" && dropTarget === item.id}
                    onDragStart={(event) => beginDesktopDrag(event, item)}
                    onDragEnd={finishDesktopDrag}
                    onDragOver={(event) =>
                      item.kind === "folder"
                        ? handleMoveDragOver(event, item.id)
                        : undefined
                    }
                    onDragLeave={(event) =>
                      item.kind === "folder"
                        ? handleMoveDragLeave(event, item.id)
                        : undefined
                    }
                    onDrop={(event) =>
                      item.kind === "folder"
                        ? handleMoveDrop(event, item.id, item.name)
                        : undefined
                    }
                    onPointerDown={(event) => beginTouchDrag(event, item)}
                    onPointerMove={moveTouchDrag}
                    onPointerUp={finishTouchDrag}
                    onPointerCancel={cancelTouchDrag}
                  />
                ))}
              </div>
            ) : (
              <div className="file-grid">
                {visibleItems.map((item) => (
                  <article
                    key={item.id}
                    className={[
                      "file-card",
                      "draggable-item",
                      selected.has(item.id) ? "selected" : "",
                      draggedIds.has(item.id) ? "is-dragging" : "",
                      item.kind === "folder" && dropTarget === item.id
                        ? "drop-target"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    draggable
                    data-drop-folder-id={
                      item.kind === "folder" ? item.id : undefined
                    }
                    onDragStart={(event) => beginDesktopDrag(event, item)}
                    onDragEnd={finishDesktopDrag}
                    onDragOver={(event) => {
                      if (item.kind === "folder") {
                        handleMoveDragOver(event, item.id);
                      }
                    }}
                    onDragLeave={(event) => {
                      if (item.kind === "folder") {
                        handleMoveDragLeave(event, item.id);
                      }
                    }}
                    onDrop={(event) => {
                      if (item.kind === "folder") {
                        handleMoveDrop(event, item.id, item.name);
                      }
                    }}
                    onPointerDown={(event) => beginTouchDrag(event, item)}
                    onPointerMove={moveTouchDrag}
                    onPointerUp={finishTouchDrag}
                    onPointerCancel={cancelTouchDrag}
                    onContextMenu={(event) => {
                      if (touchDragSession.current?.active) event.preventDefault();
                    }}
                    onClick={(event) => {
                      if (
                        !(window.matchMedia?.("(pointer: coarse)").matches ||
                          window.navigator.maxTouchPoints > 0) ||
                        (event.target as HTMLElement).closest(
                          "button, input, label, .card-actions",
                        )
                      ) {
                        return;
                      }
                      item.kind === "folder"
                        ? openFolder(item)
                        : void download(item);
                    }}
                    onDoubleClick={() =>
                      item.kind === "folder" ? openFolder(item) : void download(item)
                    }
                  >
                    <div className={`card-icon ${item.kind}`}>
                      {fileIcon(item, 29)}
                    </div>
                    <button
                      className="card-check"
                      onClick={() => toggleSelection(item.id)}
                      aria-label={`选择 ${item.name}`}
                    >
                      {selected.has(item.id) ? (
                        <Check size={14} />
                      ) : (
                        <span />
                      )}
                    </button>
                    <strong title={item.name}>{item.name}</strong>
                    <span>
                      {item.kind === "folder"
                        ? "文件夹"
                        : formatBytes(item.size)}
                    </span>
                    <div className="card-actions">
                      {item.kind === "file" && (
                        <>
                          <button title="分享" onClick={() => onOpenShares(item)}>
                            <Share2 size={15} />
                          </button>
                          <button
                            className="download-action"
                            title="下载"
                            aria-label={`下载 ${item.name}`}
                            onClick={() => void download(item)}
                          >
                            <Download size={15} />
                          </button>
                        </>
                      )}
                      <button onClick={() => setModal({ type: "rename", item })}>
                        <MoreHorizontal size={16} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      {dragging && (
        <div
          className="drop-overlay"
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (event.currentTarget === event.target) setDragging(false);
          }}
          onDrop={handleUploadDrop}
        >
          <div>
            <UploadCloud size={38} />
            <strong>松开即可上传</strong>
            <span>支持大文件分片与断点续传</span>
          </div>
        </div>
      )}

      {touchDragPreview && (
        <div
          className="touch-drag-preview"
          style={{
            left: touchDragPreview.x,
            top: touchDragPreview.y,
          }}
          aria-hidden="true"
        >
          <Move size={17} />
          <span>{touchDragPreview.label}</span>
          {touchDragPreview.count > 1 && (
            <strong>{touchDragPreview.count}</strong>
          )}
        </div>
      )}

      {tasks.length > 0 && (
        <UploadCenter
          tasks={tasks}
          open={uploadPanelOpen}
          onToggle={() => setUploadPanelOpen((value) => !value)}
          onPause={(id) => void pauseTask(id)}
          onResume={resumeTask}
          onClear={() =>
            setTasks((current) =>
              current.filter(
                (task) =>
                  task.status !== "complete" && task.status !== "error",
              ),
            )
          }
        />
      )}

      {modal?.type === "folder" && (
        <TextModal
          title="新建文件夹"
          label="文件夹名称"
          placeholder="例如：旅行照片"
          confirmText="创建文件夹"
          onClose={() => setModal(null)}
          onConfirm={async (name) => {
            await createFolder(userId, currentFolder?.id ?? null, name);
            setModal(null);
            await refresh();
          }}
        />
      )}
      {modal?.type === "rename" && (
        <TextModal
          title="重命名"
          label="新名称"
          initialValue={modal.item.name}
          confirmText="保存"
          onClose={() => setModal(null)}
          onConfirm={async (name) => {
            await renameDriveItem(modal.item.id, name);
            setModal(null);
            await refresh();
          }}
        />
      )}
      {modal?.type === "move" && (
        <MoveModal
          targets={modal.items}
          folders={folders}
          onClose={() => setModal(null)}
          onConfirm={async (parentId) => {
            await moveDriveItems(
              modal.items.map((item) => item.id),
              parentId,
            );
            setModal(null);
            await refresh();
          }}
        />
      )}
      {modal?.type === "delete" && (
        <ConfirmModal
          title={`删除 ${modal.items.length} 项内容？`}
          description="文件夹内的所有内容也会被永久删除，此操作无法撤销。"
          confirmText="永久删除"
          onClose={() => setModal(null)}
          onConfirm={async () => {
            await deleteDriveItems(modal.items);
            setModal(null);
            await refresh();
          }}
        />
      )}

      {toast && (
        <div className="toast">
          <CircleAlert size={17} />
          <span>{toast}</span>
          <button onClick={() => setToast(null)}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function FileRow(props: {
  item: DriveItem;
  checked: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onDownload: () => void;
  onShare: () => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
  dragging: boolean;
  dropTarget: boolean;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void | undefined;
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void | undefined;
  onDrop: (event: DragEvent<HTMLDivElement>) => void | undefined;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className={[
        "file-row",
        "draggable-item",
        props.checked ? "selected" : "",
        props.dragging ? "is-dragging" : "",
        props.dropTarget ? "drop-target" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      draggable
      data-drop-folder-id={
        props.item.kind === "folder" ? props.item.id : undefined
      }
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerCancel}
      onContextMenu={(event) => {
        if (props.dragging) event.preventDefault();
      }}
    >
      <label>
        <input type="checkbox" checked={props.checked} onChange={props.onToggle} />
      </label>
      <button
        className="file-name"
        onClick={() => {
          if (
            window.matchMedia?.("(pointer: coarse)").matches ||
            window.navigator.maxTouchPoints > 0
          ) {
            props.onOpen();
          }
        }}
        onDoubleClick={props.onOpen}
      >
        <span className={`file-icon ${props.item.kind}`}>
          {fileIcon(props.item)}
        </span>
        <span title={props.item.name}>{props.item.name}</span>
      </button>
      <span className="muted">
        {props.item.kind === "folder" ? "—" : formatBytes(props.item.size)}
      </span>
      <span className="muted">{formatDate(props.item.updated_at)}</span>
      <div className="row-actions">
        {props.item.kind === "file" && (
          <>
            <button title="分享" onClick={props.onShare}>
              <Share2 size={16} />
            </button>
            <button
              className="download-action"
              title="下载"
              aria-label={`下载 ${props.item.name}`}
              onClick={props.onDownload}
            >
              <Download size={16} />
            </button>
          </>
        )}
        <div className="menu-wrap">
          <button title="更多操作">
            <MoreHorizontal size={17} />
          </button>
          <div className="context-menu">
            {props.item.kind === "folder" && (
              <button onClick={props.onOpen}>
                <FolderOpen size={15} />
                打开
              </button>
            )}
            {props.item.kind === "file" && (
              <button onClick={props.onShare}>
                <Share2 size={15} />
                分享
              </button>
            )}
            <button onClick={props.onRename}>
              <FileText size={15} />
              重命名
            </button>
            <button onClick={props.onMove}>
              <Move size={15} />
              移动
            </button>
            <button className="danger-text" onClick={props.onDelete}>
              <Trash2 size={15} />
              删除
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function UploadCenter(props: {
  tasks: UploadTask[];
  open: boolean;
  onToggle: () => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onClear: () => void;
}) {
  const active = props.tasks.filter((task) =>
    ["queued", "uploading", "paused", "retrying"].includes(task.status),
  ).length;
  return (
    <aside className={`upload-center ${props.open ? "open" : ""}`}>
      <button className="upload-center-head" onClick={props.onToggle}>
        <span>
          <UploadCloud size={18} />
          <strong>{active ? `正在上传 ${active} 项` : "上传任务"}</strong>
        </span>
        <ChevronDown size={17} />
      </button>
      {props.open && (
        <div className="upload-list">
          {props.tasks.map((task) => {
            const progress =
              task.total > 0 ? Math.min(100, (task.uploaded / task.total) * 100) : 0;
            return (
              <div className="upload-task" key={task.id}>
                <div className="upload-file-icon">
                  <File size={18} />
                </div>
                <div className="upload-task-main">
                  <strong title={task.displayName}>{task.displayName}</strong>
                  <div className="task-meta">
                    <span>
                      {task.status === "complete"
                        ? "上传完成"
                        : task.status === "error"
                          ? task.error || "上传失败"
                          : `${progress.toFixed(0)}% · ${formatSpeed(task.speed)}`}
                    </span>
                    <span>
                      {formatBytes(task.uploaded)} / {formatBytes(task.total)}
                    </span>
                  </div>
                  <div className={`task-track ${task.status}`}>
                    <span style={{ width: `${progress}%` }} />
                  </div>
                </div>
                <div className="task-action">
                  {task.status === "uploading" && (
                    <button onClick={() => props.onPause(task.id)} title="暂停">
                      <Pause size={15} />
                    </button>
                  )}
                  {task.status === "paused" && (
                    <button onClick={() => props.onResume(task.id)} title="继续">
                      <Play size={15} />
                    </button>
                  )}
                  {task.status === "error" && (
                    <button onClick={() => props.onResume(task.id)} title="重试">
                      <RotateCcw size={15} />
                    </button>
                  )}
                  {task.status === "complete" && <Check size={16} />}
                </div>
              </div>
            );
          })}
          <button className="clear-tasks" onClick={props.onClear}>
            清除已完成任务
          </button>
        </div>
      )}
    </aside>
  );
}

function ModalFrame(props: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={props.onClose}>
      <section className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2>{props.title}</h2>
          <button onClick={props.onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>
        {props.children}
      </section>
    </div>
  );
}

function TextModal(props: {
  title: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  confirmText: string;
  onClose: () => void;
  onConfirm: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(props.initialValue ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <ModalFrame title={props.title} onClose={props.onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          void props
            .onConfirm(value)
            .catch((submitError) => setError(messageFrom(submitError)))
            .finally(() => setBusy(false));
        }}
      >
        <label className="modal-field">
          <span>{props.label}</span>
          <input
            autoFocus
            value={value}
            maxLength={255}
            placeholder={props.placeholder}
            onChange={(event) => setValue(event.target.value)}
            required
          />
        </label>
        {error && <p className="modal-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={props.onClose}>
            取消
          </button>
          <button className="primary-button" disabled={busy || !value.trim()}>
            {busy && <LoaderCircle className="spin" size={16} />}
            {props.confirmText}
          </button>
        </div>
      </form>
    </ModalFrame>
  );
}

function MoveModal(props: {
  targets: DriveItem[];
  folders: DriveItem[];
  onClose: () => void;
  onConfirm: (parentId: number | null) => Promise<void>;
}) {
  const [target, setTarget] = useState<number | "root">("root");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = new Set(props.targets.map((item) => item.id));
  return (
    <ModalFrame title={`移动 ${props.targets.length} 项内容`} onClose={props.onClose}>
      <div className="folder-picker">
        <button
          className={target === "root" ? "active" : ""}
          onClick={() => setTarget("root")}
        >
          <HardDrive size={17} />
          我的云盘
          {target === "root" && <Check size={16} />}
        </button>
        {props.folders
          .filter((folder) => !blocked.has(folder.id))
          .map((folder) => (
            <button
              key={folder.id}
              className={target === folder.id ? "active" : ""}
              onClick={() => setTarget(folder.id)}
            >
              <Folder size={17} />
              {folder.name}
              {target === folder.id && <Check size={16} />}
            </button>
          ))}
      </div>
      {error && <p className="modal-error">{error}</p>}
      <div className="modal-actions">
        <button className="secondary-button" onClick={props.onClose}>
          取消
        </button>
        <button
          className="primary-button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            void props
              .onConfirm(target === "root" ? null : target)
              .catch((submitError) => setError(messageFrom(submitError)))
              .finally(() => setBusy(false));
          }}
        >
          {busy && <LoaderCircle className="spin" size={16} />}
          移动到这里
        </button>
      </div>
    </ModalFrame>
  );
}

function ConfirmModal(props: {
  title: string;
  description: string;
  confirmText: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <ModalFrame title={props.title} onClose={props.onClose}>
      <div className="confirm-copy">
        <span className="danger-icon">
          <Trash2 size={21} />
        </span>
        <p>{props.description}</p>
      </div>
      {error && <p className="modal-error">{error}</p>}
      <div className="modal-actions">
        <button className="secondary-button" onClick={props.onClose}>
          取消
        </button>
        <button
          className="danger-button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            void props
              .onConfirm()
              .catch((submitError) => setError(messageFrom(submitError)))
              .finally(() => setBusy(false));
          }}
        >
          {busy && <LoaderCircle className="spin" size={16} />}
          {props.confirmText}
        </button>
      </div>
    </ModalFrame>
  );
}
