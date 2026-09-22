"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ELECTRON_APP = "/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Applications/.hidden/Electron.app";

function brandedAppPath() {
  return path.join(os.homedir(), "Library", "Application Support", "Cuewell", "Cuewell.app");
}

function relaunchAsCuewell() {
  if (process.platform !== "darwin") return false;
  if (process.execPath.includes(`${path.sep}Cuewell.app${path.sep}`)) return false;
  const binary = ensureBrandedApp();
  if (!binary) return false;
  const child = spawn(binary, process.argv.slice(1), {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  process.exit(0);
}

function ensureBrandedApp() {
  const source = path.join(ELECTRON_APP, "Contents", "MacOS", "Electron");
  if (!fs.existsSync(source)) return "";
  const appPath = brandedAppPath();
  const binary = path.join(appPath, "Contents", "MacOS", "Electron");
  const icon = path.join(__dirname, "..", "ui", "cuewell.icns");
  const stamp = path.join(appPath, "Contents", "Resources", ".cuewell-stamp");
  const current = fs.existsSync(icon) ? String(fs.statSync(icon).mtimeMs) : "none";
  if (fs.existsSync(binary) && fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8") === current) return binary;

  fs.rmSync(appPath, { recursive: true, force: true });
  fs.mkdirSync(path.join(appPath, "Contents", "MacOS"), { recursive: true });
  fs.mkdirSync(path.join(appPath, "Contents", "Resources"), { recursive: true });
  fs.copyFileSync(source, binary);
  fs.chmodSync(binary, 0o755);
  fs.symlinkSync(path.join(ELECTRON_APP, "Contents", "Frameworks"), path.join(appPath, "Contents", "Frameworks"));
  const asar = path.join(ELECTRON_APP, "Contents", "Resources", "default_app.asar");
  if (fs.existsSync(asar)) fs.copyFileSync(asar, path.join(appPath, "Contents", "Resources", "default_app.asar"));
  if (fs.existsSync(icon)) fs.copyFileSync(icon, path.join(appPath, "Contents", "Resources", "cuewell.icns"));
  fs.writeFileSync(path.join(appPath, "Contents", "Info.plist"), infoPlist());
  fs.writeFileSync(stamp, current);
  try {
    const { execFileSync } = require("child_process");
    execFileSync("codesign", ["--force", "--sign", "-", binary], { stdio: "ignore" });
  } catch (error) {
    console.error("Could not sign the Cuewell app wrapper:", error.message);
  }
  return binary;
}

function infoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>Cuewell</string>
  <key>CFBundleExecutable</key>
  <string>Electron</string>
  <key>CFBundleIconFile</key>
  <string>cuewell</string>
  <key>CFBundleIdentifier</key>
  <string>com.cuewell.resolve</string>
  <key>CFBundleName</key>
  <string>Cuewell</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleVersion</key>
  <string>1.0.0</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSPrincipalClass</key>
  <string>AtomApplication</string>
</dict>
</plist>
`;
}

module.exports = { relaunchAsCuewell, ensureBrandedApp };
