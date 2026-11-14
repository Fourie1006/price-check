#!/bin/bash
# Run once after unzipping Price Check on a Mac.
# It removes the "downloaded from the internet" flag and signs the app on your own Mac,
# which Apple Silicon needs before it will open an app that was not built by Apple-registered developers.
APP="/Applications/Price Check.app"
[ -d "$APP" ] || APP="$(cd "$(dirname "$0")" && pwd)/Price Check.app"
if [ ! -d "$APP" ]; then
  echo "Could not find Price Check.app."
  echo "Drag 'Price Check.app' into your Applications folder, then run this file again."
  read -n 1 -s -r -p "Press any key to close"
  exit 1
fi
xattr -cr "$APP"
codesign --force --deep --sign - "$APP" && echo "Done. Open Price Check from your Applications folder." || echo "Signing failed - try right-click > Open on the app instead."
read -n 1 -s -r -p "Press any key to close"
