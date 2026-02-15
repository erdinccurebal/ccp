import { writeFileSync, unlinkSync, existsSync, mkdirSync, rmSync, chmodSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { loadConfig, getConfigFilePath } from "./config.ts";

const SERVICE_LABEL = "ccp";
const SYSTEMD_SERVICE_NAME = "ccp";

function getNodePath(): string {
  try {
    return execSync("which node", { encoding: "utf-8" }).trim();
  } catch {
    return "node";
  }
}

function getCcpBinPath(): string {
  try {
    return execSync("which ccp", { encoding: "utf-8" }).trim();
  } catch {
    // Fallback: resolve from this file's location
    return join(import.meta.dirname, "cli.js");
  }
}

// ── macOS (launchd) ──

const MAC_APP_DIR = join(homedir(), ".ccp", "CCP.app");
const MAC_APP_CONTENTS = join(MAC_APP_DIR, "Contents");
const MAC_APP_MACOS = join(MAC_APP_CONTENTS, "MacOS");

function getMacPlistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", "ccp.plist");
}

function resolveAbsolutePath(bin: string): string {
  if (bin.startsWith("/")) return bin;
  try {
    return execSync(`which ${bin}`, { encoding: "utf-8" }).trim();
  } catch {
    return bin;
  }
}

function buildMacAppBundle(): void {
  const nodePath = getNodePath();
  const ccpPath = getCcpBinPath();

  // Create .app bundle structure
  mkdirSync(MAC_APP_MACOS, { recursive: true });

  // Info.plist — gives the app its name in Login Items
  const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>CCP</string>
    <key>CFBundleDisplayName</key>
    <string>CCP</string>
    <key>CFBundleIdentifier</key>
    <string>com.ccp.proxy</string>
    <key>CFBundleExecutable</key>
    <string>ccp-launcher</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>LSUIElement</key>
    <true/>
</dict>
</plist>`;
  writeFileSync(join(MAC_APP_CONTENTS, "Info.plist"), infoPlist, "utf-8");

  // Launcher script
  const launcher = `#!/bin/bash
exec "${nodePath}" "${ccpPath}" start
`;
  const launcherPath = join(MAC_APP_MACOS, "ccp-launcher");
  writeFileSync(launcherPath, launcher, "utf-8");
  chmodSync(launcherPath, 0o755);
}

function buildMacPlist(): string {
  const config = loadConfig();
  const logDir = join(homedir(), ".ccp", "logs");
  const launcherPath = join(MAC_APP_MACOS, "ccp-launcher");

  mkdirSync(logDir, { recursive: true });

  // Resolve CLAUDE_PATH to absolute so launchd can find it
  if (!config.CLAUDE_PATH || !config.CLAUDE_PATH.startsWith("/")) {
    config.CLAUDE_PATH = resolveAbsolutePath(config.CLAUDE_PATH || "claude");
  }

  // Include PATH so child processes can find tools
  const currentPath = process.env.PATH || "/usr/local/bin:/usr/bin:/bin";

  const envEntries = [
    ...Object.entries(config).filter(([, v]) => v).map(([k, v]) => `        <key>${k}</key>\n        <string>${v}</string>`),
    `        <key>PATH</key>\n        <string>${currentPath}</string>`,
  ].join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SERVICE_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${launcherPath}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
${envEntries}
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>AssociatedBundleIdentifiers</key>
    <string>com.ccp.proxy</string>
    <key>StandardOutPath</key>
    <string>${join(logDir, "ccp-stdout.log")}</string>
    <key>StandardErrorPath</key>
    <string>${join(logDir, "ccp-stderr.log")}</string>
</dict>
</plist>`;
}

function macInstall(): void {
  const plistPath = getMacPlistPath();
  if (existsSync(plistPath)) {
    console.log("  Service is already installed. Run 'ccp service uninstall' first to reinstall.");
    return;
  }
  buildMacAppBundle();
  writeFileSync(plistPath, buildMacPlist(), "utf-8");
  console.log(`  Service installed: ${plistPath}`);
  console.log(`  App bundle: ${MAC_APP_DIR}`);
  console.log(`  Config: ${getConfigFilePath()}`);
  console.log(`  Logs:   ~/.ccp/logs/`);
  console.log(`\n  Run 'ccp service start' to start the service.`);
}

function macUninstall(): void {
  const plistPath = getMacPlistPath();
  if (!existsSync(plistPath)) {
    console.log("  Service is not installed.");
    return;
  }
  // Stop first if running
  try {
    execSync(`launchctl bootout gui/$(id -u) ${plistPath} 2>/dev/null`, { stdio: "ignore" });
  } catch {
    // May not be loaded
  }
  unlinkSync(plistPath);
  // Remove app bundle
  if (existsSync(MAC_APP_DIR)) {
    rmSync(MAC_APP_DIR, { recursive: true, force: true });
  }
  console.log("  Service uninstalled.");
}

function macStart(): void {
  const plistPath = getMacPlistPath();
  if (!existsSync(plistPath)) {
    console.error("  Service is not installed. Run 'ccp service install' first.");
    process.exit(1);
  }
  try {
    execSync(`launchctl bootstrap gui/$(id -u) ${plistPath}`, { stdio: "inherit" });
    console.log("  Service started.");
  } catch {
    // Already loaded — try kickstart
    try {
      execSync(`launchctl kickstart -k gui/$(id -u)/${SERVICE_LABEL}`, { stdio: "inherit" });
      console.log("  Service restarted.");
    } catch {
      console.log("  Service is already running.");
    }
  }
}

function macStop(): void {
  const plistPath = getMacPlistPath();
  if (!existsSync(plistPath)) {
    console.error("  Service is not installed.");
    process.exit(1);
  }
  try {
    execSync(`launchctl bootout gui/$(id -u)/${SERVICE_LABEL}`, { stdio: "inherit" });
    console.log("  Service stopped.");
  } catch {
    console.log("  Service is not running.");
  }
}

function macStatus(): void {
  try {
    const output = execSync(`launchctl print gui/$(id -u)/${SERVICE_LABEL} 2>&1`, { encoding: "utf-8" });
    const pidMatch = output.match(/pid\s*=\s*(\d+)/i);
    if (pidMatch) {
      console.log(`  Service is running (PID: ${pidMatch[1]})`);
    } else {
      console.log("  Service is loaded but not running.");
    }
  } catch {
    if (existsSync(getMacPlistPath())) {
      console.log("  Service is installed but not running.");
    } else {
      console.log("  Service is not installed.");
    }
  }
}

// ── Linux (systemd) ──

function getSystemdDir(): string {
  return join(homedir(), ".config", "systemd", "user");
}

function getSystemdServicePath(): string {
  return join(getSystemdDir(), `${SYSTEMD_SERVICE_NAME}.service`);
}

function buildSystemdUnit(): string {
  const nodePath = getNodePath();
  const ccpPath = getCcpBinPath();
  const config = loadConfig();

  // Resolve CLAUDE_PATH to absolute
  if (!config.CLAUDE_PATH || !config.CLAUDE_PATH.startsWith("/")) {
    config.CLAUDE_PATH = resolveAbsolutePath(config.CLAUDE_PATH || "claude");
  }

  const currentPath = process.env.PATH || "/usr/local/bin:/usr/bin:/bin";

  const envLines = [
    ...Object.entries(config).filter(([, v]) => v).map(([k, v]) => `Environment="${k}=${v}"`),
    `Environment="PATH=${currentPath}"`,
  ].join("\n");

  return `[Unit]
Description=CCP - Claude Code Proxy
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${ccpPath} start
Restart=on-failure
RestartSec=5
${envLines}

[Install]
WantedBy=default.target
`;
}

function linuxInstall(): void {
  const servicePath = getSystemdServicePath();
  if (existsSync(servicePath)) {
    console.log("  Service is already installed. Run 'ccp service uninstall' first to reinstall.");
    return;
  }
  mkdirSync(getSystemdDir(), { recursive: true });
  writeFileSync(servicePath, buildSystemdUnit(), "utf-8");
  try {
    execSync("systemctl --user daemon-reload", { stdio: "ignore" });
    execSync(`systemctl --user enable ${SYSTEMD_SERVICE_NAME}`, { stdio: "ignore" });
  } catch {
    // systemctl may not be available
  }
  console.log(`  Service installed: ${servicePath}`);
  console.log(`  Config: ${getConfigFilePath()}`);
  console.log(`  Autostart enabled.`);
  console.log(`\n  Run 'ccp service start' to start the service.`);
}

function linuxUninstall(): void {
  const servicePath = getSystemdServicePath();
  if (!existsSync(servicePath)) {
    console.log("  Service is not installed.");
    return;
  }
  try {
    execSync(`systemctl --user stop ${SYSTEMD_SERVICE_NAME}`, { stdio: "ignore" });
    execSync(`systemctl --user disable ${SYSTEMD_SERVICE_NAME}`, { stdio: "ignore" });
  } catch {
    // May not be running
  }
  unlinkSync(servicePath);
  try {
    execSync("systemctl --user daemon-reload", { stdio: "ignore" });
  } catch {
    // ignore
  }
  console.log("  Service uninstalled.");
}

function linuxStart(): void {
  if (!existsSync(getSystemdServicePath())) {
    console.error("  Service is not installed. Run 'ccp service install' first.");
    process.exit(1);
  }
  try {
    execSync(`systemctl --user start ${SYSTEMD_SERVICE_NAME}`, { stdio: "inherit" });
    console.log("  Service started.");
  } catch {
    console.error("  Failed to start service.");
    process.exit(1);
  }
}

function linuxStop(): void {
  if (!existsSync(getSystemdServicePath())) {
    console.error("  Service is not installed.");
    process.exit(1);
  }
  try {
    execSync(`systemctl --user stop ${SYSTEMD_SERVICE_NAME}`, { stdio: "inherit" });
    console.log("  Service stopped.");
  } catch {
    console.log("  Service is not running.");
  }
}

function linuxRestart(): void {
  if (!existsSync(getSystemdServicePath())) {
    console.error("  Service is not installed. Run 'ccp service install' first.");
    process.exit(1);
  }
  try {
    execSync(`systemctl --user restart ${SYSTEMD_SERVICE_NAME}`, { stdio: "inherit" });
    console.log("  Service restarted.");
  } catch {
    console.error("  Failed to restart service.");
    process.exit(1);
  }
}

function linuxStatus(): void {
  if (!existsSync(getSystemdServicePath())) {
    console.log("  Service is not installed.");
    return;
  }
  try {
    execSync(`systemctl --user status ${SYSTEMD_SERVICE_NAME}`, { stdio: "inherit" });
  } catch {
    // systemctl status returns non-zero for inactive services, output is already printed
  }
}

// ── Windows fallback ──

function windowsNotSupported(action: string): void {
  console.log(`\n  Service management is not supported on Windows.`);
  if (action === "install" || action === "start") {
    console.log(`  Use 'ccp start' to run the server directly.\n`);
  }
}

// ── Public API ──

export function handleService(args: string[]): void {
  const action = args[0];
  const os = platform();

  if (!action || !["install", "uninstall", "start", "stop", "restart", "status"].includes(action)) {
    console.error("Usage: ccp service <install|uninstall|start|stop|restart|status>");
    process.exit(1);
  }

  if (os === "win32") {
    windowsNotSupported(action);
    return;
  }

  if (os === "darwin") {
    switch (action) {
      case "install":   macInstall(); break;
      case "uninstall": macUninstall(); break;
      case "start":     macStart(); break;
      case "stop":      macStop(); break;
      case "restart":   macStop(); macStart(); break;
      case "status":    macStatus(); break;
    }
    return;
  }

  // Linux and other Unix-like
  switch (action) {
    case "install":   linuxInstall(); break;
    case "uninstall": linuxUninstall(); break;
    case "start":     linuxStart(); break;
    case "stop":      linuxStop(); break;
    case "restart":   linuxRestart(); break;
    case "status":    linuxStatus(); break;
  }
}
