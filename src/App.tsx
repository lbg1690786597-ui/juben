import { useEffect, useMemo, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  Download,
  Search,
  Loader2,
  LogOut,
  Film,
  FolderOpen,
  CheckCircle2,
  XCircle,
  SkipForward,
  Tag,
  RefreshCw,
  ArrowUpCircle,
} from "lucide-react";

import {
  login,
  fetchDeliveryList,
  logDownloads,
  beijingToUtcIso,
  DEFAULT_BASE,
  type UserInfo,
  type VideoItem,
} from "./api";

// ===== 本地会话持久化 =====
const LS = {
  base: "vd_base",
  token: "vd_token",
  refresh: "vd_refresh",
  user: "vd_user",
  outDir: "vd_out_dir",
  concurrency: "vd_concurrency",
};

type DownloadStatus =
  | "pending"
  | "downloading"
  | "done"
  | "error"
  | "skip";

interface RowState {
  status: DownloadStatus;
  progress: number; // 0-100
  message?: string;
}

// Rust 端进度事件负载
interface ProgressPayload {
  id: number;
  status: DownloadStatus;
  progress: number;
  message?: string;
}

export default function App() {
  const [base, setBase] = useState(
    () => localStorage.getItem(LS.base) || DEFAULT_BASE
  );
  const [token, setToken] = useState(
    () => localStorage.getItem(LS.token) || ""
  );
  const [user, setUser] = useState<UserInfo | null>(() => {
    const raw = localStorage.getItem(LS.user);
    return raw ? JSON.parse(raw) : null;
  });

  if (!token || !user) {
    return (
      <LoginView
        initialBase={base}
        onSuccess={(b, tk, rf, u) => {
          localStorage.setItem(LS.base, b);
          localStorage.setItem(LS.token, tk);
          localStorage.setItem(LS.refresh, rf);
          localStorage.setItem(LS.user, JSON.stringify(u));
          setBase(b);
          setToken(tk);
          setUser(u);
        }}
      />
    );
  }

  return (
    <MainView
      base={base}
      token={token}
      user={user}
      onLogout={() => {
        localStorage.removeItem(LS.token);
        localStorage.removeItem(LS.refresh);
        localStorage.removeItem(LS.user);
        setToken("");
        setUser(null);
      }}
    />
  );
}

// ===================== 登录页 =====================
function LoginView({
  initialBase,
  onSuccess,
}: {
  initialBase: string;
  onSuccess: (
    base: string,
    token: string,
    refresh: string,
    user: UserInfo
  ) => void;
}) {
  const [base, setBase] = useState(initialBase);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!username || !password) {
      setError("请输入用户名和密码");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await login(base, username, password);
      onSuccess(base, res.access_token, res.refresh_token, res.user);
    } catch (e: any) {
      setError(e.message || "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">
          <Film size={26} color="#fff" />
        </div>
        <div className="login-title">视频交付下载器</div>
        <div className="login-sub">使用平台账号登录，批量下载·中文命名</div>

        {error && <div className="login-error">{error}</div>}

        <div className="login-field">
          <label className="label">用户名</label>
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="平台登录用户名"
            autoFocus
          />
        </div>
        <div className="login-field">
          <label className="label">密码</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="密码"
          />
        </div>

        <button
          className="btn btn-primary"
          style={{ width: "100%", marginTop: 8 }}
          onClick={submit}
          disabled={loading}
        >
          {loading ? <Loader2 size={16} className="spin" /> : null}
          {loading ? "登录中..." : "登录"}
        </button>

        <div className="login-server">
          <label className="label">服务器地址</label>
          <input
            className="input"
            value={base}
            onChange={(e) => setBase(e.target.value)}
            placeholder="http://120.26.143.129"
          />
        </div>
      </div>
    </div>
  );
}

// ===================== 主界面 =====================
function MainView({
  base,
  token,
  user,
  onLogout,
}: {
  base: string;
  token: string;
  user: UserInfo;
  onLogout: () => void;
}) {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);

  // 筛选
  const [keyword, setKeyword] = useState("");
  const [source, setSource] = useState("");
  const [startHour, setStartHour] = useState("");
  const [endHour, setEndHour] = useState("");
  // 时长筛选(纯前端): all=全部, lt60=60分钟以内, gt60=60分钟以上, custom=自定义秒区间
  const [durPreset, setDurPreset] = useState<"all" | "lt60" | "gt60" | "custom">(
    "all"
  );
  const [durMinSec, setDurMinSec] = useState("");
  const [durMaxSec, setDurMaxSec] = useState("");

  // 选择
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // 下载
  const [downloading, setDownloading] = useState(false);
  const [rowStates, setRowStates] = useState<Record<number, RowState>>({});
  const [outDir, setOutDir] = useState(
    () => localStorage.getItem(LS.outDir) || ""
  );
  const [concurrency, setConcurrency] = useState(
    () => Number(localStorage.getItem(LS.concurrency)) || 4
  );

  // 更新检查
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  // 当前应用版本（动态读取，始终与安装包一致）
  const [appVersion, setAppVersion] = useState("");
  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion(""));
  }, []);

  // 主题（浅色/暗色，持久化；默认浅色）
  const [theme, setTheme] = useState<"dark" | "light">(
    () => (localStorage.getItem("vd_theme") as "dark" | "light") || "light"
  );
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("vd_theme", theme);
  }, [theme]);

  async function checkForUpdate() {
    setCheckingUpdate(true);
    try {
      const update = await check();
      if (update) {
        const ok = window.confirm(
          `发现新版本 v${update.version}${
            update.body ? `\n\n更新内容:\n${update.body}` : ""
          }\n\n是否立即下载并安装？安装完成后将重启应用。`
        );
        if (ok) {
          await update.downloadAndInstall();
          await relaunch();
        }
      } else {
        alert(`当前已是最新版本 v${appVersion}`);
      }
    } catch (e: any) {
      alert("检查更新失败: " + (e?.toString() || e));
    } finally {
      setCheckingUpdate(false);
    }
  }

  // 加载清单
  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchDeliveryList(base, token, {
        keyword: keyword || undefined,
        source: source || undefined,
        start_date: beijingToUtcIso(startHour),
        end_date: beijingToUtcIso(endHour, true),
      });
      setVideos(res.items);
      setTotal(res.total);
      setSelected(new Set());
    } catch (e: any) {
      if (e.message === "UNAUTHORIZED") {
        alert("登录已过期，请重新登录");
        onLogout();
      } else {
        alert("加载失败: " + e.message);
      }
    } finally {
      setLoading(false);
    }
  }, [base, token, keyword, source, startHour, endHour, onLogout]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  // 监听 Rust 下载进度事件
  useEffect(() => {
    const unlisten = listen<ProgressPayload>("download-progress", (event) => {
      const p = event.payload;
      setRowStates((prev) => ({
        ...prev,
        [p.id]: {
          status: p.status,
          progress: p.progress,
          message: p.message,
        },
      }));
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === filteredVideos.length && filteredVideos.length > 0
        ? new Set()
        : new Set(filteredVideos.map((v) => v.id))
    );
  }

  async function chooseDir(): Promise<string | null> {
    const dir = await openDialog({
      directory: true,
      multiple: false,
      title: "选择视频保存目录",
    });
    if (typeof dir === "string") {
      setOutDir(dir);
      localStorage.setItem(LS.outDir, dir);
      return dir;
    }
    return null;
  }

  async function startDownload() {
    if (selected.size === 0) {
      alert("请至少勾选一个视频");
      return;
    }
    let dir = outDir;
    if (!dir) {
      const picked = await chooseDir();
      if (!picked) return;
      dir = picked;
    }

    const items = filteredVideos
      .filter((v) => selected.has(v.id))
      .map((v) => ({ id: v.id, title: v.title, url: v.cdn_url }));

    // 初始化行状态
    const init: Record<number, RowState> = {};
    for (const it of items) init[it.id] = { status: "pending", progress: 0 };
    setRowStates(init);
    setDownloading(true);

    try {
      // 调用 Rust 下载引擎（并发+断点续传+中文命名+进度事件）
      await invoke("download_videos", {
        items,
        outDir: dir,
        concurrency,
      });

      // 上报下载统计到平台（同一张 video_download_logs 表）
      const ids = items.map((i) => i.id);
      await logDownloads(base, token, ids);
    } catch (e: any) {
      alert("下载过程出错: " + (e?.toString() || e));
    } finally {
      setDownloading(false);
    }
  }

  // 按时长档位/自定义区间做纯前端筛选(duration 单位=秒)
  const filteredVideos = useMemo(() => {
    const inRange = (sec: number, min: number, max: number) =>
      sec >= min && (max <= 0 || sec <= max);
    return videos.filter((v) => {
      const d = v.duration ?? 0;
      switch (durPreset) {
        case "lt60":
          return d > 0 && d < 3600;
        case "gt60":
          return d >= 3600;
        case "custom": {
          const min = Number(durMinSec) || 0;
          const max = Number(durMaxSec) || 0;
          return inRange(d, min, max);
        }
        default:
          return true;
      }
    });
  }, [videos, durPreset, durMinSec, durMaxSec]);

  // 全局进度统计
  const stats = useMemo(() => {
    const vals = Object.values(rowStates);
    const done = vals.filter((r) => r.status === "done").length;
    const skip = vals.filter((r) => r.status === "skip").length;
    const err = vals.filter((r) => r.status === "error").length;
    const doing = vals.filter((r) => r.status === "downloading").length;
    const totalSel = selected.size || vals.length;
    const finished = done + skip + err;
    const pct = totalSel > 0 ? Math.round((finished / totalSel) * 100) : 0;
    return { done, skip, err, doing, finished, totalSel, pct };
  }, [rowStates, selected]);

  const allSelected =
    selected.size === filteredVideos.length && filteredVideos.length > 0;

  return (
    <div className="app-root">
      {/* 顶栏 */}
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-logo">
            <Film size={18} color="#fff" />
          </div>
          <div className="topbar-title">视频交付下载器</div>
        </div>
        <div className="topbar-right">
          <span className="version-badge" title="当前版本">
            v{appVersion || "?"}
          </span>
          <button
            className="btn btn-ghost"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title={theme === "dark" ? "切换到浅色主题" : "切换到暗色主题"}
          >
            {theme === "dark" ? "☀️ 浅色" : "🌙 暗色"}
          </button>
          <button
            className="btn btn-ghost"
            onClick={checkForUpdate}
            disabled={checkingUpdate}
            title="检查更新"
          >
            {checkingUpdate ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <ArrowUpCircle size={15} />
            )}
            {checkingUpdate ? "检查中..." : "检查更新"}
          </button>
          <div className="user-chip">
            <div className="user-avatar">
              {(user.display_name || user.username || "?")
                .charAt(0)
                .toUpperCase()}
            </div>
            <span>{user.display_name || user.username}</span>
          </div>
          <button className="btn btn-ghost" onClick={onLogout}>
            <LogOut size={15} />
            退出
          </button>
        </div>
      </div>

      <div className="body">
        {/* 筛选 */}
        <div className="filters">
          <div className="filters-grid">
            <div>
              <label className="label">搜索标题</label>
              <div className="search-box">
                <Search size={16} />
                <input
                  className="input"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="输入关键词..."
                />
              </div>
            </div>
            <div>
              <label className="label">来源</label>
              <select
                className="input"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="">全部来源</option>
                <option value="feishu">飞书</option>
                <option value="novel-video">小说转视频</option>
              </select>
            </div>
            <div>
              <label className="label">时长</label>
              <select
                className="input"
                value={durPreset}
                onChange={(e) => setDurPreset(e.target.value as typeof durPreset)}
              >
                <option value="all">全部时长</option>
                <option value="lt60">60分钟以内</option>
                <option value="gt60">60分钟以上</option>
                <option value="custom">自定义(秒)</option>
              </select>
              {durPreset === "custom" && (
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    placeholder="最短(秒)"
                    value={durMinSec}
                    onChange={(e) => setDurMinSec(e.target.value)}
                  />
                  <input
                    className="input"
                    type="number"
                    min={0}
                    placeholder="最长(秒,空=不限)"
                    value={durMaxSec}
                    onChange={(e) => setDurMaxSec(e.target.value)}
                  />
                </div>
              )}
            </div>
            <div>
              <label className="label">完成时间起(北京时间)</label>
              <input
                className="input"
                type="datetime-local"
                step={3600}
                value={startHour}
                onChange={(e) => setStartHour(e.target.value)}
              />
            </div>
            <div>
              <label className="label">完成时间止(北京时间)</label>
              <input
                className="input"
                type="datetime-local"
                step={3600}
                value={endHour}
                onChange={(e) => setEndHour(e.target.value)}
              />
            </div>
          </div>
          <div className="filters-actions">
            <button
              className="btn btn-ghost"
              onClick={loadList}
              disabled={loading}
            >
              {loading ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <RefreshCw size={15} />
              )}
              刷新列表
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setKeyword("");
                setSource("");
                setStartHour("");
                setEndHour("");
                setDurPreset("all");
                setDurMinSec("");
                setDurMaxSec("");
              }}
            >
              清除筛选
            </button>
            <span className="count-hint">
              共 {total} 个视频
              {durPreset !== "all" && ` · 时长筛选后 ${filteredVideos.length} 个`}
              {" · 已选 "}
              {selected.size} 个
            </span>
          </div>
        </div>

        {/* 列表 */}
        <div className="list-wrap">
          {loading ? (
            <div className="empty">
              <Loader2 size={28} className="spin" />
              <div style={{ marginTop: 12 }}>加载中...</div>
            </div>
          ) : filteredVideos.length === 0 ? (
            <div className="empty">
              {videos.length === 0 ? "暂无匹配的视频" : "该时长范围内无视频"}
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>
                    <input
                      className="checkbox"
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                    />
                  </th>
                  <th style={{ width: 60 }}>ID</th>
                  <th>标题 / 原名</th>
                  <th style={{ width: 110 }}>来源</th>
                  <th style={{ width: 130 }}>创建时间</th>
                  <th style={{ width: 130 }}>完成时间</th>
                  <th style={{ width: 70 }}>时长</th>
                  <th style={{ width: 170 }}>状态 / 进度</th>
                </tr>
              </thead>
              <tbody>
                {filteredVideos.map((v) => {
                  const rs = rowStates[v.id];
                  return (
                    <tr
                      key={v.id}
                      className={selected.has(v.id) ? "selected" : ""}
                    >
                      <td>
                        <input
                          className="checkbox"
                          type="checkbox"
                          checked={selected.has(v.id)}
                          onChange={() => toggleSelect(v.id)}
                        />
                      </td>
                      <td style={{ color: "var(--ink-muted)" }}>{v.id}</td>
                      <td>
                        <div className="col-title" title={v.title}>
                          {v.title}
                        </div>
                        {v.original_title &&
                          v.original_title !== v.title && (
                            <div
                              className="col-subtitle"
                              title={`原小说名: ${v.original_title}`}
                              style={{
                                fontSize: 12,
                                color: "var(--ink-muted)",
                                marginTop: 2,
                              }}
                            >
                              原名: {v.original_title}
                            </div>
                          )}
                      </td>
                      <td>
                        <span
                          className={`tag ${
                            v.source === "feishu" ? "tag-feishu" : "tag-novel"
                          }`}
                        >
                          <Tag size={11} />
                          {v.source === "feishu" ? "飞书" : "小说转视频"}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                        {fmtBeijing(v.created_at)}
                      </td>
                      <td style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                        {fmtBeijing(v.updated_at)}
                      </td>
                      <td style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                        {fmtDuration(v.duration)}
                      </td>
                      <td>
                        <RowStatusCell state={rs} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* 底部下载栏 */}
      <div className="footer">
        <button className="btn btn-ghost" onClick={chooseDir}>
          <FolderOpen size={15} />
          {outDir ? "保存目录已选" : "选择保存目录"}
        </button>
        {outDir && (
          <span
            className="footer-stat"
            style={{
              maxWidth: 260,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={outDir}
          >
            {outDir}
          </span>
        )}

        <select
          className="concurrency-select"
          value={concurrency}
          onChange={(e) => {
            const n = Number(e.target.value);
            setConcurrency(n);
            localStorage.setItem(LS.concurrency, String(n));
          }}
          title="并发下载数"
        >
          <option value={2}>并发 2</option>
          <option value={4}>并发 4</option>
          <option value={6}>并发 6</option>
          <option value={8}>并发 8</option>
        </select>

        {downloading && (
          <>
            <div className="global-progress">
              <div
                className="global-progress-bar"
                style={{ width: `${stats.pct}%` }}
              />
            </div>
            <span className="footer-stat">
              {stats.finished}/{stats.totalSel} · 成功{stats.done} 跳过
              {stats.skip} 失败{stats.err}
            </span>
          </>
        )}

        {!downloading && stats.finished > 0 && outDir && (
          <button
            className="btn btn-ghost"
            onClick={() => openPath(outDir)}
          >
            <FolderOpen size={15} />
            打开文件夹
          </button>
        )}

        <button
          className="btn btn-primary"
          onClick={startDownload}
          disabled={downloading || selected.size === 0}
          style={{ marginLeft: downloading ? 0 : "auto" }}
        >
          {downloading ? (
            <Loader2 size={16} className="spin" />
          ) : (
            <Download size={16} />
          )}
          {downloading
            ? "下载中..."
            : `批量下载${selected.size > 0 ? ` (${selected.size})` : ""}`}
        </button>
      </div>
    </div>
  );
}

// UTC ISO → 北京时间显示（yyyy-MM-dd HH:mm）
function fmtBeijing(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${bj.getUTCFullYear()}-${p(bj.getUTCMonth() + 1)}-${p(
    bj.getUTCDate()
  )} ${p(bj.getUTCHours())}:${p(bj.getUTCMinutes())}`;
}

// 秒 → mm:ss
function fmtDuration(sec?: number): string {
  if (!sec || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function RowStatusCell({ state }: { state?: RowState }) {
  if (!state) {
    return <span className="status status-pending">—</span>;
  }
  switch (state.status) {
    case "pending":
      return <span className="status status-pending">等待中</span>;
    case "downloading":
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div className="row-progress">
            <div
              className="row-progress-bar"
              style={{ width: `${state.progress}%` }}
            />
          </div>
          <span className="status status-downloading">
            {state.progress}%
          </span>
        </div>
      );
    case "done":
      return (
        <span className="status status-done">
          <CheckCircle2 size={14} />
          完成
        </span>
      );
    case "skip":
      return (
        <span className="status status-skip">
          <SkipForward size={14} />
          已存在
        </span>
      );
    case "error":
      return (
        <span
          className="status status-error"
          title={state.message || "下载失败"}
        >
          <XCircle size={14} />
          失败
        </span>
      );
  }
}