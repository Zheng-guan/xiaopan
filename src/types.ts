export type DriveItemKind = "file" | "folder";

export interface DriveItem {
  id: number;
  user_id: string;
  parent_id: number | null;
  kind: DriveItemKind;
  name: string;
  size: number;
  mime_type: string | null;
  storage_path: string | null;
  storage_provider: "supabase" | "r2";
  created_at: string;
  updated_at: string;
}

export interface DriveUsage {
  used_bytes: number;
  file_count: number;
  folder_count: number;
}

export interface DriveQuota {
  quota_bytes: number;
  used_bytes: number;
  reserved_bytes: number;
  remaining_bytes: number;
  is_admin: boolean;
  personal_user_count: number;
}

export type SortKey = "name" | "updated_at" | "size";
export type SortDirection = "asc" | "desc";
export type ViewMode = "list" | "grid";
export type CategoryFilter = "all" | "recent" | "image" | "video" | "document";

export type UploadStatus =
  | "queued"
  | "uploading"
  | "paused"
  | "retrying"
  | "cancelling"
  | "complete"
  | "error";

export interface UploadTask {
  id: string;
  file: File;
  displayName: string;
  parentId: number | null;
  status: UploadStatus;
  uploaded: number;
  total: number;
  speed: number;
  error?: string;
}

export type DownloadStatus =
  | "preparing"
  | "downloading"
  | "fallback"
  | "complete"
  | "cancelled"
  | "error";

export interface DownloadTask {
  id: string;
  item: DriveItem;
  status: DownloadStatus;
  downloaded: number;
  total: number;
  speed: number;
  concurrency: number;
  error?: string;
}

export interface AdminUserSummary {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  usedBytes: number;
  quotaBytes: number;
  isAdmin: boolean;
  fileCount: number;
  folderCount: number;
}

export interface AdminOverview {
  currentAdminId: string;
  totals: {
    users: number;
    files: number;
    folders: number;
    usedBytes: number;
    storageBytes: number;
    personalUserCount: number;
  };
  users: AdminUserSummary[];
}

export type ShareType = "file" | "text" | "link";

export interface ShareRecord {
  id: number;
  user_id: string;
  public_id: string;
  share_type: ShareType;
  title: string;
  text_content: string | null;
  link_url: string | null;
  file_id: number | null;
  expires_at: string | null;
  view_count: number;
  created_at: string;
  file: {
    name: string;
    size: number;
    mime_type: string | null;
  } | null;
}

export interface PublicShare {
  type: ShareType;
  title: string;
  textContent: string | null;
  linkUrl: string | null;
  file: {
    name: string;
    size: number;
    mimeType: string | null;
  } | null;
  expiresAt: string | null;
  createdAt: string;
  viewCount: number;
}

export interface QuickText {
  id: number;
  user_id: string;
  content: string;
  created_at: string;
}
