#!/usr/bin/env bash
# 发布 Hetu.Api 为 Tauri sidecar 可执行文件。
# 用法：
#   ./scripts/publish-backend.sh                        # 默认 SelfContained + 自动 RID
#   ./scripts/publish-backend.sh FrameworkDependent linux-x64
set -euo pipefail

MODE="${1:-SelfContained}"
RID="${2:-}"

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
api_proj="$repo_root/src/Hetu.Api/Hetu.Api.csproj"
binaries_dir="$repo_root/shell/hetu-desktop/src-tauri/binaries"

# 自动推断 RID（若未传）
if [[ -z "${RID}" ]]; then
  uname_s="$(uname -s)"
  uname_m="$(uname -m)"
  case "$uname_s" in
    Linux)  os=linux ;;
    Darwin) os=osx ;;
    MINGW*|MSYS*|CYGWIN*) os=win ;;
    *) echo "unsupported OS: $uname_s" >&2; exit 1 ;;
  esac
  case "$uname_m" in
    x86_64|amd64) arch=x64 ;;
    arm64|aarch64) arch=arm64 ;;
    *) echo "unsupported arch: $uname_m" >&2; exit 1 ;;
  esac
  RID="$os-$arch"
fi

case "$RID" in
  win-x64)     triple="x86_64-pc-windows-msvc";    suffix=".exe" ;;
  win-arm64)   triple="aarch64-pc-windows-msvc";   suffix=".exe" ;;
  osx-x64)     triple="x86_64-apple-darwin";       suffix="" ;;
  osx-arm64)   triple="aarch64-apple-darwin";      suffix="" ;;
  linux-x64)   triple="x86_64-unknown-linux-gnu";  suffix="" ;;
  linux-arm64) triple="aarch64-unknown-linux-gnu"; suffix="" ;;
  *) echo "unknown RID: $RID" >&2; exit 1 ;;
esac

case "$MODE" in
  SelfContained)        self=true ;;
  FrameworkDependent)   self=false ;;
  *) echo "unknown mode: $MODE" >&2; exit 1 ;;
esac

publish_dir="$repo_root/artifacts/publish/$MODE-$RID"
rm -rf "$publish_dir"
mkdir -p "$binaries_dir"

echo "[publish-backend] Mode=$MODE  Rid=$RID  Triple=$triple"
echo "[publish-backend] Output: $publish_dir"

extra_args=()
if [[ "$self" == "true" ]]; then
  extra_args+=("/p:IncludeNativeLibrariesForSelfExtract=true" "/p:EnableCompressionInSingleFile=true")
fi

dotnet publish "$api_proj" \
  -c Release \
  -r "$RID" \
  --self-contained="$self" \
  -o "$publish_dir" \
  "/p:PublishSingleFile=$self" \
  "${extra_args[@]}"

src_exe="$publish_dir/Hetu.Api$suffix"
[[ -f "$src_exe" ]] || { echo "missing $src_exe" >&2; exit 1; }
dst_exe="$binaries_dir/Hetu.Api-$triple$suffix"
cp -f "$src_exe" "$dst_exe"
echo "[publish-backend] sidecar -> $dst_exe"

if [[ -d "$publish_dir/wwwroot" ]]; then
  rm -rf "$binaries_dir/wwwroot"
  cp -R "$publish_dir/wwwroot" "$binaries_dir/wwwroot"
  echo "[publish-backend] wwwroot -> $binaries_dir/wwwroot"
fi

if [[ -d "$publish_dir/sqlite-vec" ]]; then
  rm -rf "$binaries_dir/sqlite-vec"
  cp -R "$publish_dir/sqlite-vec" "$binaries_dir/sqlite-vec"
  echo "[publish-backend] sqlite-vec -> $binaries_dir/sqlite-vec"
fi

echo "[publish-backend] Done. Next: cd shell/hetu-desktop && npm run tauri build"
