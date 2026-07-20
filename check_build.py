#!/usr/bin/env python3
"""查询 juben 仓库最新一次 Windows 编译的状态和产物下载地址。

用法:
    GH_TOKEN=你的token python3 check_build.py
"""
import json
import os
import sys
import urllib.request

TOKEN = os.environ.get("GH_TOKEN")
if not TOKEN:
    print("请先设置环境变量 GH_TOKEN=你的GitHub令牌")
    sys.exit(1)

OWNER, REPO = "lbg1690786597-ui", "juben"


def get(path):
    req = urllib.request.Request(f"https://api.github.com{path}")
    req.add_header("Authorization", "token " + TOKEN)
    req.add_header("Accept", "application/vnd.github+json")
    return json.loads(urllib.request.urlopen(req, timeout=30).read())


d = get(f"/repos/{OWNER}/{REPO}/actions/runs?per_page=1")
runs = d.get("workflow_runs", [])
if not runs:
    print("还没有编译记录")
    sys.exit(0)

r = runs[0]
status_map = {
    "queued": "排队中(等待云端 Windows 空闲)",
    "in_progress": "编译中(约需 5-10 分钟)",
    "completed": "已完成",
}
concl_map = {
    "success": "✅ 成功",
    "failure": "❌ 失败",
    "cancelled": "已取消",
    None: "进行中",
}
print("=" * 50)
print("最新编译:", status_map.get(r["status"], r["status"]))
print("结论:", concl_map.get(r.get("conclusion"), r.get("conclusion")))
print("网页查看:", r["html_url"])

if r["status"] == "completed":
    if r.get("conclusion") == "success":
        a = get(f"/repos/{OWNER}/{REPO}/actions/runs/{r['id']}/artifacts")
        print("\n🎉 编译成功! 下载安装包:")
        for x in a.get("artifacts", []):
            mb = round(x["size_in_bytes"] / 1024 / 1024, 1)
            print(f"  产物名: {x['name']} ({mb}MB)")
        print(f"\n👉 打开这个网址下载(需登录 GitHub): {r['html_url']}")
        print("   页面底部 Artifacts 区点击产物名即可下载 zip，解压得到 exe")
    else:
        print("\n编译失败，打开上面的网页查看红色错误日志，把日志发给 AI 修复")
print("=" * 50)