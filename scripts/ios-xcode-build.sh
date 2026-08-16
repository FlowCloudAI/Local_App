#!/bin/zsh
# iOS Xcode 构建阶段入口。
# Xcode 不会加载交互式 shell 配置，本脚本负责找到 Node/Rust 并回到仓库根目录调用 Tauri。

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR:h}"

prepend_if_dir() {
  if [[ -d "$1" ]]; then
    export PATH="$1:$PATH"
  fi
}

prepend_if_dir "$HOME/.cargo/bin"
prepend_if_dir "$HOME/.local/node/bin"
prepend_if_dir "$HOME/.volta/bin"
prepend_if_dir "$HOME/.local/share/mise/shims"
prepend_if_dir "/opt/homebrew/bin"
prepend_if_dir "/usr/local/bin"

# nvm/fnm 通常只在交互式 shell 中生效；Xcode 启动的构建阶段需要主动寻找其 Node 目录。
if ! command -v node >/dev/null 2>&1; then
  setopt null_glob
  for candidate in \
    "$HOME"/.nvm/versions/node/*/bin/node(N) \
    "$HOME"/Library/Application\ Support/fnm/node-versions/*/installation/bin/node(N); do
    prepend_if_dir "${candidate:h}"
    break
  done
fi

if ! command -v node >/dev/null 2>&1; then
  print -u2 "[iOS 构建] 未找到 Node.js。请先运行 npm run ios:doctor，并确认 Node 安装目录可用。"
  exit 127
fi

if ! command -v cargo >/dev/null 2>&1; then
  print -u2 "[iOS 构建] 未找到 Cargo。请确认 Rust 安装在 ~/.cargo，或将 Cargo 加入系统 PATH。"
  exit 127
fi

TAURI_BIN="$REPO_ROOT/node_modules/.bin/tauri"
if [[ ! -x "$TAURI_BIN" ]]; then
  print -u2 "[iOS 构建] 未找到本地 Tauri CLI，请先在仓库根目录执行 npm install。"
  exit 127
fi

TAURI_CONFIG="$REPO_ROOT/src-tauri/tauri.conf.json"
if [[ ! -f "$TAURI_CONFIG" ]]; then
  print -u2 "[iOS 构建] 无法从脚本位置定位 src-tauri/tauri.conf.json：$TAURI_CONFIG"
  exit 2
fi

# xcode-script 是隐藏的内部子命令；显式传入目录可避免 Xcode 工作目录与文件扫描策略干扰项目识别。
export TAURI_APP_PATH="$REPO_ROOT/src-tauri"
export TAURI_FRONTEND_PATH="$REPO_ROOT"

cd "$REPO_ROOT"
exec "$TAURI_BIN" ios xcode-script "$@"
