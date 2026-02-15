#!/usr/bin/env bash
# Build AetherClawMac as a proper .app bundle and launch it.
# Running the raw executable does not show the menu bar icon; the .app bundle does.

set -e
cd "$(dirname "$0")"

echo "Building AetherClawMac..."
swift build --product AetherClawMac

APP_NAME="AetherClawMac"
APP_DIR=".build/debug/${APP_NAME}.app"
BINARY=".build/debug/${APP_NAME}"
RESOURCES_SRC="Sources/OpenClaw/Resources"

echo "Creating .app bundle at ${APP_DIR}..."
rm -rf "${APP_DIR}"
mkdir -p "${APP_DIR}/Contents/MacOS"
mkdir -p "${APP_DIR}/Contents/Resources"

# Copy Sparkle.framework next to the binary so @rpath/@executable_path finds it
if [ -d ".build/debug/Sparkle.framework" ]; then
  cp -R ".build/debug/Sparkle.framework" "${APP_DIR}/Contents/MacOS/"
fi

cp "${BINARY}" "${APP_DIR}/Contents/MacOS/${APP_NAME}"
chmod +x "${APP_DIR}/Contents/MacOS/${APP_NAME}"

# Copy AetherClawApp's resource bundle (icns, DeviceModels) so Bundle.main finds them
if [ -d ".build/debug/AetherClawMac_OpenClawApp.bundle" ]; then
  cp -R ".build/debug/AetherClawMac_OpenClawApp.bundle" "${APP_DIR}/Contents/MacOS/"
fi

cp "${RESOURCES_SRC}/AetherClaw.icns" "${APP_DIR}/Contents/Resources/"
cp -R "${RESOURCES_SRC}/DeviceModels" "${APP_DIR}/Contents/Resources/"

# Copy Info.plist and set executable name to match the product (AetherClawMac)
cp "${RESOURCES_SRC}/Info.plist" "${APP_DIR}/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable ${APP_NAME}" "${APP_DIR}/Contents/Info.plist"

# Quit any existing instance so the new one isn't killed by the duplicate-instance check
killall "${APP_NAME}" 2>/dev/null || true
sleep 0.5

echo "Launching ${APP_NAME}.app..."
open "${APP_DIR}"
echo ""
echo "If you still don't see the app, run in terminal to see any crash output:"
echo "  ${APP_DIR}/Contents/MacOS/${APP_NAME}"
echo ""
echo "Otherwise check the Dock and the menu bar overflow (>>)."
