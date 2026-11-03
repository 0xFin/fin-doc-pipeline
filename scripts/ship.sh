#!/bin/sh
# Test, refresh the installed skill copy, commit and push in one go.
#
#   ./scripts/ship.sh                     auto commit message
#   ./scripts/ship.sh "feat: something"   custom commit message
#   ./scripts/ship.sh --no-push           commit locally only
#
# The skill is installed as a *copy*, so install.sh must run again after every
# change or the agent keeps executing the old code. install.sh --link replaces
# the copy with a symlink and makes this step automatic.

set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

MESSAGE=""
PUSH="yes"
for arg in "$@"; do
  case "$arg" in
    --no-push) PUSH="no" ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) MESSAGE="$arg" ;;
  esac
done

echo "== 1/5 生成单文件 index.html =="
node scripts/build-web.mjs

echo "== 2/5 运行测试 =="
node test/run.mjs

echo "== 3/5 同步到技能目录 =="
./install.sh

echo "== 4/5 提交 =="
if [ -z "$(git status --porcelain)" ]; then
  echo "  没有改动需要提交"
else
  git add -A
  git commit -m "${MESSAGE:-chore: sync skill and web build}"
  echo "  已提交 $(git log --oneline -1)"
fi

if [ "$PUSH" = "no" ]; then
  echo "== 5/5 跳过推送（--no-push） =="
  exit 0
fi

echo "== 5/5 推送到 GitHub =="
GIT_SSH_COMMAND='ssh -o BatchMode=yes -o ConnectTimeout=20' git push origin HEAD
echo "  已推送 $(git log --oneline -1)"

tag="v$(node -p "require('./package.json').version")"
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "  标签 $tag 已存在"
else
  git tag "$tag"
  echo "  已创建标签 $tag"
fi
GIT_SSH_COMMAND='ssh -o BatchMode=yes -o ConnectTimeout=20' git push origin "$tag" >/dev/null
echo "  标签 $tag 已推送"
