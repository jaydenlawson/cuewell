#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC="$ROOT/plugin/com.cuewell.resolve"
DEST="/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/com.cuewell.resolve"
NODE_SRC="/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Workflow Integrations/Examples/SamplePlugin/WorkflowIntegration.node"

if [[ ! -d "$SRC" ]]; then
  echo "Could not find $SRC"
  exit 1
fi

copy_tree() {
  if mkdir -p "$DEST" 2>/dev/null && cp -R "$SRC/." "$DEST/"; then
    return
  fi
  echo "Administrator permission is required to install into:"
  echo "  $DEST"
  sudo mkdir -p "$DEST"
  sudo cp -R "$SRC/." "$DEST/"
}

copy_tree
rm -f "$DEST/WorkflowIntegration.node"
if [[ -f "$NODE_SRC" ]]; then
  cp "$NODE_SRC" "$DEST/WorkflowIntegration.node" 2>/dev/null || sudo cp "$NODE_SRC" "$DEST/WorkflowIntegration.node"
else
  echo "WorkflowIntegration.node was not found in the Resolve developer examples."
  echo "The panel will still open, but timeline import needs that file from DaVinci Resolve Studio."
fi

echo "Installed Cuewell to:"
echo "  $DEST"
echo "Quit DaVinci Resolve Studio completely, reopen it, then choose Workspace > Workflow Integrations > Cuewell."
