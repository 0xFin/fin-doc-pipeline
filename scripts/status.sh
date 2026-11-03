#!/bin/sh
# Show whether the repository, GitHub and the installed skill are in sync.
#
#   ./scripts/status.sh
#
# Exit code is 0 when everything matches, 1 otherwise.

set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

problems=0

echo "仓库    $(pwd)"
echo "分支    $(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD)"
latest_tag=$(git tag --sort=-creatordate | head -1)
version=$(node -p "require('./package.json').version" 2>/dev/null || sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' package.json)
echo "标签    ${latest_tag:-无}"
if [ -n "$version" ] && [ "$latest_tag" = "v$version" ]; then
  echo "版本    ${version}（标签一致）"
else
  echo "版本    ${version:-未知}，最新标签 ${latest_tag:-无}"
  problems=1
fi

dirty=$(git status --porcelain | wc -l | tr -d ' ')
if [ "$dirty" -eq 0 ]; then
  echo "未提交  干净"
else
  echo "未提交  ${dirty} 个文件"
  problems=1
fi

upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)
if [ -z "$upstream" ]; then
  echo "GitHub  未设置上游分支"
  problems=1
else
  ahead=$(git rev-list --count "$upstream..HEAD")
  behind=$(git rev-list --count "HEAD..$upstream")
  if [ "$ahead" -eq 0 ] && [ "$behind" -eq 0 ]; then
    echo "GitHub  已同步"
  else
    echo "GitHub  ${ahead} 个待推送，${behind} 个待拉取"
    problems=1
  fi
fi

dest="${HOME}/.dsh/skills/fin-doc-pipeline"
if [ ! -e "$dest" ]; then
  echo "技能    未安装"
  problems=1
elif [ -L "$dest" ]; then
  echo "技能    软链 -> $(readlink "$dest")"
else
  diff_count=$(diff -rq --exclude=.git --exclude=node_modules --exclude=.DS_Store \
    . "$dest" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$diff_count" -eq 0 ]; then
    echo "技能    与仓库一致"
  else
    echo "技能    有 ${diff_count} 处差异（运行 ./install.sh 同步）"
    problems=1
  fi
fi

echo
if [ "$problems" -eq 0 ]; then
  echo "三方一致。"
else
  echo "存在差异，运行 ./scripts/ship.sh 可一次性修复。"
fi
exit "$problems"
