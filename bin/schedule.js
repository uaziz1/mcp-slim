/**
 * Schedule/unschedule mcp-slim evolve via launchd (macOS) or crontab (Linux).
 */

import { writeFile, unlink } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
import { homedir, platform } from "os";

const PLIST_PATH = join(homedir(), "Library", "LaunchAgents", "com.mcp-slim.evolve.plist");
const LABEL = "com.mcp-slim.evolve";

function frequencyToInterval(freq) {
  switch (freq) {
    case "daily": return 86400;
    case "weekly": return 604800;
    case "hourly": return 3600;
    default: return 604800; // default weekly
  }
}

function frequencyToCron(freq) {
  switch (freq) {
    case "daily": return "0 6 * * *";
    case "weekly": return "0 6 * * 0";
    case "hourly": return "0 * * * *";
    default: return "0 6 * * 0";
  }
}

export async function scheduleEvolve(frequency = "weekly") {
  const os = platform();

  if (os === "darwin") {
    // macOS: launchd
    const interval = frequencyToInterval(frequency);

    // Resolve full path to npx (may not be on PATH in launchd)
    let npxPath = "npx";
    try {
      npxPath = execSync("which npx", { encoding: "utf8" }).trim();
    } catch { /* fall back to bare "npx" */ }

    // Ensure ~/.mcp-slim/ exists for the log file
    mkdirSync(join(homedir(), ".mcp-slim"), { recursive: true });

    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${npxPath}</string>
    <string>@uaziz1/mcp-slim</string>
    <string>evolve</string>
    <string>--auto</string>
  </array>
  <key>StartInterval</key>
  <integer>${interval}</integer>
  <key>StandardOutPath</key>
  <string>${join(homedir(), ".mcp-slim", "evolve.log")}</string>
  <key>StandardErrorPath</key>
  <string>${join(homedir(), ".mcp-slim", "evolve.log")}</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>`;

    await writeFile(PLIST_PATH, plist);
    try {
      execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null`, { stdio: "ignore" });
    } catch { /* not loaded yet */ }
    execSync(`launchctl load "${PLIST_PATH}"`);

    console.log(`Scheduled mcp-slim evolve (${frequency})`);
    console.log(`  Plist: ${PLIST_PATH}`);
    console.log(`  Log: ~/.mcp-slim/evolve.log`);

  } else {
    // Linux: crontab
    const cronExpr = frequencyToCron(frequency);
    const cronLine = `${cronExpr} npx @uaziz1/mcp-slim evolve --auto >> ~/.mcp-slim/evolve.log 2>&1`;

    try {
      const existing = execSync("crontab -l 2>/dev/null", { encoding: "utf8" });
      const filtered = existing.split("\n").filter(l => !l.includes("mcp-slim evolve")).join("\n");
      const updated = filtered.trim() + "\n" + cronLine + "\n";
      execSync("crontab -", { input: updated, encoding: "utf8" });
    } catch {
      execSync("crontab -", { input: cronLine + "\n", encoding: "utf8" });
    }

    console.log(`Scheduled mcp-slim evolve (${frequency})`);
    console.log(`  Cron: ${cronExpr}`);
    console.log(`  Log: ~/.mcp-slim/evolve.log`);
  }
}

export async function unscheduleEvolve() {
  const os = platform();

  if (os === "darwin") {
    try {
      execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null`, { stdio: "ignore" });
    } catch { /* not loaded */ }
    if (existsSync(PLIST_PATH)) {
      await unlink(PLIST_PATH);
    }
    console.log("Unscheduled mcp-slim evolve (removed launchd plist)");

  } else {
    try {
      const existing = execSync("crontab -l 2>/dev/null", { encoding: "utf8" });
      const filtered = existing.split("\n").filter(l => !l.includes("mcp-slim evolve")).join("\n");
      execSync("crontab -", { input: filtered.trim() + "\n", encoding: "utf8" });
    } catch { /* no crontab */ }
    console.log("Unscheduled mcp-slim evolve (removed crontab entry)");
  }
}
