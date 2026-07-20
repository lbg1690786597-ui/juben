# 应用图标说明

Tauri 打包需要以下图标文件放在本目录（`src-tauri/icons/`）：

- `32x32.png`
- `128x128.png`
- `128x128@2x.png`
- `icon.ico`（Windows 安装包用）
- `icon.png`（源图，1024x1024 推荐）

## 最简单的生成方式（推荐）

Tauri CLI 自带图标生成命令。准备一张 **1024x1024 的 PNG 源图**（命名为 `app-icon.png` 放到项目根 `apps/downloader/` 下），然后在 `apps/downloader/` 目录执行：

```bash
pnpm tauri icon app-icon.png
```

该命令会自动生成上述所有尺寸的图标并放到本目录。

## 临时占位（若暂时没有设计图）

如果只是想先跑起来测试，可以随便找一张正方形 PNG 图片，用上面的命令生成即可。
`build.bat` 打包前请确保本目录已有图标，否则 Tauri 会报错。

> 提示：也可以直接从平台 web 端的 logo/favicon 取一张 512x512 以上的 PNG 作为源图。