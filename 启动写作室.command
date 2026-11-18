#!/bin/zsh
cd "${0:A:h}"
if ! curl --silent --fail http://127.0.0.1:8767/ >/dev/null; then
  /usr/bin/python3 server.py &
  runner=$!
  trap 'kill $runner 2>/dev/null' EXIT
  sleep 1
fi
open http://127.0.0.1:8767/
if [[ -n "$runner" ]]; then
  echo '写作室正在运行。关闭此窗口会停止服务，已保存的作文会保留。'
  wait "$runner"
fi
