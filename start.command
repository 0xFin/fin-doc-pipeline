#!/bin/sh
# Double-click this file to serve the folder and open the processor.
# Closing the Terminal window stops the server.

cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)" || exit 1

for port in 8000 8001 8002 8003 8004 8005; do
  if ! lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    python3 -m http.server "$port" >/dev/null 2>&1 &
    server=$!
    sleep 1
    open "http://127.0.0.1:$port/"
    echo "文本文档处理器已启动：http://127.0.0.1:$port/"
    echo "关闭这个终端窗口即可停止服务。"
    wait "$server"
    exit 0
  fi
done

echo "8000-8005 端口都被占用，请先关闭占用端口的程序。" >&2
exit 1
