#!/bin/sh
# Install fin-doc-pipeline as an agent skill.
#
#   ./install.sh                     copy into ~/.dsh/skills
#   ./install.sh --link              symlink instead (edits take effect immediately)
#   ./install.sh --dest ~/.claude/skills
#   ./install.sh --uninstall
#
# The skill directory name must stay "fin-doc-pipeline" to match the
# frontmatter name, otherwise the provider skips it.

set -eu

NAME="fin-doc-pipeline"
SRC_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MODE="copy"
DEST_ROOT="${HOME}/.dsh/skills"

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --link) MODE="link"; shift ;;
    --copy) MODE="copy"; shift ;;
    --dest) DEST_ROOT="$2"; shift 2 ;;
    --uninstall) MODE="uninstall"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

DEST="${DEST_ROOT}/${NAME}"

if [ "$MODE" = "uninstall" ]; then
  rm -rf "$DEST"
  echo "removed ${DEST}"
  exit 0
fi

mkdir -p "$DEST_ROOT"
rm -rf "$DEST"

if [ "$MODE" = "link" ]; then
  ln -s "$SRC_DIR" "$DEST"
  echo "linked ${DEST} -> ${SRC_DIR}"
else
  cp -R "$SRC_DIR" "$DEST"
  rm -rf "$DEST/.git" "$DEST/out" "$DEST/out2"
  find "$DEST" -name '.DS_Store' -delete 2>/dev/null || true
  echo "installed ${DEST}"
fi

echo
echo "Skill directory : ${DEST}"
echo "Frontmatter name: $(sed -n 's/^name: //p' "${DEST}/SKILL.md" | head -1)"
echo "Smoke test      : node \"${DEST}/src/cli.mjs\" --version"
echo
echo "The provider picks this up within a few seconds; no restart is needed."
