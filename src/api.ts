// ===== 后端 API 封装（复用平台 orchestrator 接口）=====
// 使用 Tauri HTTP 插件的 fetch（从 Rust 侧发请求，绕过 WebView 的明文 HTTP / mixed-content 限制）
import { fetch } from "@tauri-apps/plugin-http";

export interface UserInfo {
  id: number;
  username: string;
  display_name: string | null;
  role: string;
}

export interface LoginResult {
  user: UserInfo;
  access_token: string;
  refresh_token: string;
}

export interface VideoItem {
  id: number;
  title: string;
  original_title?: string | null; // 原小说名
  cdn_url: string;
  source: string;
  created_at: string | null;
  updated_at?: string | null; // 实际生成完成时间
  feishu_record_id?: string | null; // 飞书来源行
  duration?: number; // 时长(秒)
  download_count: number;
}

export interface DeliveryListResult {
  total: number;
  items: VideoItem[];
}

// 默认服务器地址（可在登录页修改并记忆）
export const DEFAULT_BASE = "http://118.196.33.51";

function trimBase(base: string): string {
  return base.replace(/\/+$/, "");
}

/** 登录：复用平台 /v1/auth/login，返回 JWT */
export async function login(
  base: string,
  username: string,
  password: string
): Promise<LoginResult> {
  const res = await fetch(`${trimBase(base)}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    let msg = "登录失败";
    try {
      const j = await res.json();
      msg = j.detail || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json();
}

/** 用 refresh_token 续签 access_token */
export async function refreshToken(
  base: string,
  refresh_token: string
): Promise<string> {
  const res = await fetch(`${trimBase(base)}/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token }),
  });
  if (!res.ok) throw new Error("会话已过期，请重新登录");
  const j = await res.json();
  return j.access_token as string;
}

export interface DeliveryFilters {
  keyword?: string;
  source?: string;
  start_date?: string; // UTC ISO
  end_date?: string; // UTC ISO
}

/** 拉取鉴权版全量交付清单 */
export async function fetchDeliveryList(
  base: string,
  token: string,
  filters: DeliveryFilters
): Promise<DeliveryListResult> {
  const params = new URLSearchParams();
  if (filters.keyword) params.set("keyword", filters.keyword);
  if (filters.source) params.set("source", filters.source);
  if (filters.start_date) params.set("start_date", filters.start_date);
  if (filters.end_date) params.set("end_date", filters.end_date);

  const url = `${trimBase(base)}/v1/video-delivery/delivery-list?${params}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error(`获取清单失败(${res.status})`);
  return res.json();
}

/** 批量记录下载统计（写入平台同一张 video_download_logs 表） */
export async function logDownloads(
  base: string,
  token: string,
  job_ids: number[]
): Promise<void> {
  if (job_ids.length === 0) return;
  const res = await fetch(`${trimBase(base)}/v1/video-delivery/log-download`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ job_ids }),
  });
  // 统计失败不阻塞下载，仅忽略
  if (!res.ok) {
    console.warn("下载统计上报失败", res.status);
  }
}

/** 北京时间(datetime-local 值,如 2026-07-14T21:00) → UTC ISO */
export function beijingToUtcIso(local: string, endOfMinute = false): string | undefined {
  if (!local) return undefined;
  const suffix = endOfMinute ? ":59+08:00" : ":00+08:00";
  const d = new Date(`${local}${suffix}`);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString();
}