#!/usr/bin/env python3
"""通过 GitHub REST API 上传文件到仓库（绕过被墙的 git:443）"""
import base64
import json
import os
import sys
import urllib.request
import urllib.error

TOKEN = os.environ["GH_TOKEN"]
OWNER = "lbg1690786597-ui"
REPO = "juben"
BRANCH = "main"
ROOT = os.path.dirname(os.path.abspath(__file__))

# 需要上传的文件（相对本目录）
FILES = [
    ".github/workflows/build-windows.yml",
    ".gitignore",
    "README.md",
    "build.bat",
    "index.html",
    "package.json",
    "pnpm-lock.yaml",
    "tsconfig.json",
    "tsconfig.node.json",
    "vite.config.ts",
    "src/main.tsx",
    "src/App.tsx",
    "src/api.ts",
    "src/styles.css",
    "src-tauri/Cargo.toml",
    "src-tauri/build.rs",
    "src-tauri/tauri.conf.json",
    "src-tauri/capabilities/default.json",
    "src-tauri/icons/README.md",
    "src-tauri/src/main.rs",
    "src-tauri/src/lib.rs",
]


def api(method, path, body=None):
    url = f"https://api.github.com{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"token {TOKEN}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def get_existing_sha(path):
    """若文件已存在，取其 sha 以便更新"""
    status, data = api("GET", f"/repos/{OWNER}/{REPO}/contents/{path}?ref={BRANCH}")
    if status == 200 and isinstance(data, dict):
        return data.get("sha")
    return None


def put_file(path):
    full = os.path.join(ROOT, path)
    with open(full, "rb") as f:
        content_b64 = base64.b64encode(f.read()).decode()
    body = {
        "message": f"add {path}",
        "content": content_b64,
        "branch": BRANCH,
    }
    sha = get_existing_sha(path)
    if sha:
        body["sha"] = sha
    status, data = api("PUT", f"/repos/{OWNER}/{REPO}/contents/{path}", body)
    return status, data


def main():
    ok = 0
    fail = 0
    for i, path in enumerate(FILES, 1):
        if not os.path.exists(os.path.join(ROOT, path)):
            print(f"[{i}/{len(FILES)}] 跳过(不存在): {path}")
            continue
        status, data = put_file(path)
        if status in (200, 201):
            ok += 1
            print(f"[{i}/{len(FILES)}] ✓ {path}")
        else:
            fail += 1
            msg = data.get("message", data) if isinstance(data, dict) else data
            print(f"[{i}/{len(FILES)}] ✗ {path} -> HTTP {status}: {msg}")
    print(f"\n完成: 成功 {ok} / 失败 {fail} / 总计 {len(FILES)}")
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()