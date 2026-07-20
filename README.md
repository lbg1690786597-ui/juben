# 视频交付下载器（Windows 桌面版）

一个用于**批量下载平台视频**的 Windows 桌面应用。相比网页端下载，它彻底解决了：

- ❌ 网页 CDN 加速/多选/重命名互相冲突、量大就丢
- ❌ 下载文件名是 hash、要额外跑重命名脚本
- ❌ 大文件经服务器代理转发拖垮带宽

## ✨ 核心特性

- **复用平台账号登录**：用你在网页平台的同一账号密码登录，无需新注册
- **下载数据进同一后台**：每次下载都记入平台 `video_download_logs`，管理员在网页后台可按用户查询
- **稳定批量下载**：Rust 原生多线程并发（可调 2/4/6/8）+ 断点续传 + 失败自动重试
- **中文自动命名**：下载即用视频标题命名（如 `免费借道六年_第01集.mp4`），无需再重命名
- **实时进度**：每个视频独立进度条 + 全局进度统计
- **筛选**：按标题关键词 / 来源（飞书/小说转视频）/ 生成时间段（北京时间）筛选

## 📦 给最终用户（只需拿到 exe）

1. 拿到 `视频交付下载器_1.0.0_x64-setup.exe`，双击安装
2. 打开应用，用**平台账号密码**登录（服务器地址默认已填，如需改可在登录页底部修改）
3. 勾选要下载的视频 → 选择保存目录 → 点"批量下载"
4. 完成后可点"打开文件夹"查看，文件已是中文名

> ⚠️ 首次运行若被 Windows Defender 拦截提示"未知发布者"，点"更多信息 → 仍要运行"即可（因为暂未做代码签名）。

## 🛠️ 给打包者（如何从源码生成 exe）

### 前置环境（一次性安装）
- **Node.js 18+**：https://nodejs.org/
- **Rust**：https://www.rust-lang.org/tools/install （安装后重开命令行）
- **Microsoft C++ Build Tools**（Tauri 依赖）：装 Visual Studio 时勾选"使用 C++ 的桌面开发"，或单独装 Build Tools

### 一键打包
1. 把整个 `apps/downloader/` 目录拷到 Windows 电脑
2. 准备应用图标：放一张 1024x1024 的 PNG 命名 `app-icon.png` 到 `apps/downloader/`，然后执行 `pnpm tauri icon app-icon.png`（详见 `src-tauri/icons/README.md`）
3. **双击 `build.bat`**（或命令行运行），脚本会自动检查环境→装依赖→编译打包
4. 完成后在 `src-tauri\target\release\bundle\nsis\` 找到安装包 exe

### 开发调试（可选）
```bash
pnpm install
pnpm tauri:dev    # 启动开发模式，热重载
```

## 🔌 依赖的后端接口（均复用平台 orchestrator）

| 用途 | 接口 |
|---|---|
| 登录 | `POST /v1/auth/login` |
| 续签 | `POST /v1/auth/refresh` |
| 交付清单（鉴权版） | `GET /v1/video-delivery/delivery-list` |
| 下载统计上报 | `POST /v1/video-delivery/log-download` |

## 📁 项目结构

```
apps/downloader/
├── build.bat                    # ⭐ Windows 一键打包脚本
├── package.json
├── index.html
├── src/                         # 前端 (React + TS)
│   ├── main.tsx
│   ├── App.tsx                  # 登录页 + 主界面 + 下载编排
│   ├── api.ts                   # 后端接口封装
│   └── styles.css               # 深色主题(复刻平台)
└── src-tauri/                   # 后端 (Rust)
    ├── Cargo.toml
    ├── tauri.conf.json          # 窗口/打包配置
    ├── capabilities/default.json# 权限
    ├── icons/                   # 应用图标(需生成)
    └── src/
        ├── main.rs
        └── lib.rs               # ⭐ 下载引擎(并发/断点续传/中文命名/进度)
```

## 🔒 安全说明

- 登录 token 存于应用本地（localStorage），退出即清除
- 下载走 CDN 直连，服务器只负责鉴权和记录统计，不代理视频流量
- 面向外部客户分发时建议做**代码签名**避免杀软误报（需购买代码签名证书）