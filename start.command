#!/bin/sh
# Optional launcher: index.html already works when opened directly from disk,
# so you only need this for a stable http:// address (for example to open the
# page from a phone on the same network).
# Double-click it to serve the folder and open the processor; closing the
# Terminal window stops the server.

cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)" || exit 1

for port in 8000 8001 8002 8003 8004 8005; do
  if ! lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    python3 -m http.server "$port" >/dev/null 2>&1 &
    server=$!
    sleep 1
    open "http://127.0.0.1:$port/"
    echo "文本文档处理器已启动：http://127.0.0.1:$port/"
    echo "（index.html 本身双击就能离线运行，这里只是提供一个固定地址）"
    echo "关闭这个终端窗口即可停止服务。"
    wait "$server"
    exit 0
  fi
done

echo "8000-8005 端口都被占用，请先关闭占用端口的程序。" >&2
exit 1
