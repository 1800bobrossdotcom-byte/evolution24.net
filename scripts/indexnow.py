#!/usr/bin/env python3
"""Tells IndexNow (Bing, Yandex and the assistants that search with them) which pages changed,
so they read them again now rather than on their next visit. Google does not take part; it has
the sitemap's dates.

    python3 scripts/indexnow.py <from-commit> [to-commit]      the pages changed between them
    python3 scripts/indexnow.py --all                          every page in the sitemap

The availability job runs it after each publish. It never fails the job: a ping that does not
go through is reported, and the next change pings again. Stdlib only.
"""
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://evolution24.net"
ENDPOINT = "https://api.indexnow.org/indexnow"


def key():
    m = re.search(r'^INDEXNOW_KEY = "([0-9a-f]{32})"', (ROOT / "scripts/build.py").read_text(), re.M)
    return m.group(1)


def sitemap_urls():
    return re.findall(r"<loc>([^<]+)</loc>", (ROOT / "sitemap.xml").read_text())


def changed_urls(a, b="HEAD"):
    files = subprocess.run(["git", "diff", "--name-only", a, b], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    known = set(sitemap_urls())
    urls = []
    for f in files:
        if f == "index.html":
            u = f"{SITE}/"
        elif f.endswith("/index.html"):
            u = f"{SITE}/{f[:-len('index.html')]}"
        else:
            continue
        if u in known:
            urls.append(u)
    return urls


def main():
    args = sys.argv[1:]
    urls = sitemap_urls() if args == ["--all"] else changed_urls(*args[:2]) if args else []
    if not urls:
        print("IndexNow: no pages changed.")
        return
    k = key()
    body = json.dumps({"host": SITE.split("//")[1], "key": k, "keyLocation": f"{SITE}/{k}.txt", "urlList": urls[:10000]}).encode()
    req = urllib.request.Request(ENDPOINT, data=body, headers={"Content-Type": "application/json; charset=utf-8"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            print(f"IndexNow: {len(urls)} pages sent, answered {r.status}.")
    except Exception as e:        # 202 is success too; anything else is reported, never fatal
        print(f"IndexNow: not sent ({e}).")


if __name__ == "__main__":
    main()
