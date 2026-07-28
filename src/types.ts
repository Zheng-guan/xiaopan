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
  created_at: string;
  updated_at: string;
}

export interface DriveUsage {
  used_bytes: number;
  file_count: number;
  folder_count: number;
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
  | "complete"
  | "error";

export interface UploadTask {
  id: string;
  file: File;
  displayName: string;
  status: UploadStatus;
  uploaded: number;
  total: number;
  speed: number;
  error?: string;
}

export interface AdminUserSummary {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  usedBytes: number;
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
