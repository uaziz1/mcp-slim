#!/usr/bin/env node

/**
 * mcp-slim CLI
 *
 * Commands:
 *   (default)    Start the MCP proxy server (used by Claude Code via .mcp.json)
 *   serve        Same as default
 *   observe      Scan session transcripts for raw MCP calls
 *   evolve       Run observe + detect, output promotion candidates
 *   validate     Validate all modules
 *   status       Show active modules, tool count, estimated savings
 *   init         Set up ~/.mcp-slim/ directory and register skills
 */

import { dirname, join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { readdir } from "fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");
const HOME_DIR = join(process.env.HOME || process.env.USERPROFILE || "~", ".mcp-slim");

// Resolve modules directory
function getModulesDir() {
  if (process.env.MCP_SLIM_MODULES) return resolve(process.env.MCP_SLIM_MODULES);
  if (existsSync(join(HOME_DIR, "modules"))) return join(HOME_DIR, "modules");
  return join(PKG_ROOT, "src", "modules");
}

// Resolve config
function getConfig() {
  const configPath = process.env.MCP_SLIM_CONFIG || join(HOME_DIR, "config.json");
  if (existsSync(configPath)) {
    try {
      return JSON.parse(readFileSync(configPath, "utf8"));
    } catch { /* fall through */ }
  }
  return {};
}

const command = process.argv[2] || "serve";

switch (command) {
  case "serve": {
    const { startServer } = await import(pathToFileURL(join(PKG_ROOT, "src", "server.js")).href);
    await startServer(getModulesDir());
    break;
  }

  case "observe": {
    const { runObserver } = await import(pathToFileURL(join(PKG_ROOT, "bin", "observe.js")).href);
    await runObserver();
    break;
  }

  case "evolve": {
    const flags = process.argv.slice(3);
    const isAuto = flags.includes("--auto");
    const scheduleIdx = flags.indexOf("--schedule");
    const unschedule = flags.includes("--unschedule");

    if (unschedule) {
      const { unscheduleEvolve } = await import(pathToFileURL(join(PKG_ROOT, "bin", "schedule.js")).href);
      await unscheduleEvolve();
    } else if (scheduleIdx >= 0) {
      const frequency = flags[scheduleIdx + 1] || "weekly";
      const { scheduleEvolve } = await import(pathToFileURL(join(PKG_ROOT, "bin", "schedule.js")).href);
      await scheduleEvolve(frequency);
    } else {
      // Run observe first
      const { runObserver } = await import(pathToFileURL(join(PKG_ROOT, "bin", "observe.js")).href);
      await runObserver();
      // Then detect
      const { runDetector } = await import(pathToFileURL(join(PKG_ROOT, "bin", "detect.js")).href);
      const candidates = await runDetector({
        json: isAuto,
        modulesDir: getModulesDir(),
      });

      if (isAuto && candidates.length > 0) {
        // Auto mode: invoke claude -p to generate modules
        const { execFileSync } = await import("child_process");
        const candidatesPath = join(HOME_DIR, "candidates.json");
        const { writeFileSync } = await import("fs");
        mkdirSync(HOME_DIR, { recursive: true });
        writeFileSync(candidatesPath, JSON.stringify(candidates, null, 2));

        const templatePath = join(PKG_ROOT, "src", "modules", "_template.js");
        const sharedPath = join(PKG_ROOT, "src", "shared.js");
        const targetDir = getModulesDir();

        const prompt = [
          `Read the mcp-slim promotion candidates at ${candidatesPath}.`,
          `Read the module template at ${templatePath} and shared utilities at ${sharedPath}.`,
          `For each candidate, generate a proxy module following the template pattern.`,
          `Write each module to ${targetDir}/<suggested_name>.js.`,
          `Then run: node ${join(PKG_ROOT, "bin", "mcp-slim.js")} validate`,
          `Report what was generated and estimated savings.`,
        ].join(" ");

        try {
          execFileSync("claude", ["-p", prompt], { stdio: "inherit" });
        } catch {
          console.error("[mcp-slim] Auto-generate failed. Run /slim-evolve in Claude Code instead.");
        }
      }
    }
    break;
  }

  case "validate": {
    const { runValidator } = await import(pathToFileURL(join(PKG_ROOT, "bin", "validate.js")).href);
    const target = process.argv[3];
    await runValidator(target || getModulesDir());
    break;
  }

  case "status": {
    const modulesDir = getModulesDir();
    let moduleCount = 0;
    let toolCount = 0;

    try {
      const files = (await readdir(modulesDir))
        .filter(f => f.endsWith(".js") && !f.startsWith("_") && !f.endsWith(".example.js") && f !== "shared.js");
      moduleCount = files.length;

      for (const f of files) {
        try {
          const mod = await import(pathToFileURL(join(modulesDir, f)).href);
          toolCount += (mod.default?.tools || []).length;
        } catch { /* skip broken modules */ }
      }
    } catch { /* no modules dir */ }

    const obsPath = join(HOME_DIR, "observations.jsonl");
    let obsCount = 0;
    let lastObserve = "never";
    if (existsSync(obsPath)) {
      const { readFileSync, statSync } = await import("fs");
      const lines = readFileSync(obsPath, "utf8").trim().split("\n");
      obsCount = lines.filter(l => l.trim()).length;
      lastObserve = statSync(obsPath).mtime.toISOString().slice(0, 16).replace("T", " ");
    }

    console.log(`mcp-slim status`);
    console.log(`  Modules directory: ${modulesDir}`);
    console.log(`  Active modules:    ${moduleCount}`);
    console.log(`  Proxy tools:       ${toolCount}`);
    console.log(`  Observations:      ${obsCount}`);
    console.log(`  Last observed:     ${lastObserve}`);
    break;
  }

  case "init": {
    // Create ~/.mcp-slim/ structure
    mkdirSync(join(HOME_DIR, "modules"), { recursive: true });
    console.log(`Created ${HOME_DIR}/modules/`);

    // Copy shared.js to modules dir so modules can import it
    const { copyFileSync } = await import("fs");
    copyFileSync(
      join(PKG_ROOT, "src", "shared.js"),
      join(HOME_DIR, "modules", "shared.js")
    );
    console.log(`Copied shared.js to ${HOME_DIR}/modules/`);

    // Run setup script if available
    const setupPath = join(PKG_ROOT, "setup");
    if (existsSync(setupPath)) {
      const { execSync } = await import("child_process");
      try {
        execSync(`bash "${setupPath}"`, { stdio: "inherit", cwd: PKG_ROOT });
      } catch {
        console.log("Skill registration skipped (run ./setup manually if needed).");
      }
    }

    console.log(`\nDone. Add this to your .mcp.json:\n`);
    console.log(JSON.stringify({
      "mcp-slim": {
        command: "npx",
        args: ["-y", "@uaziz1/mcp-slim"],
        env: { MCP_SLIM_MODULES: join(HOME_DIR, "modules") }
      }
    }, null, 2));
    break;
  }

  default:
    // No args = serve (Claude Code invokes this way)
    if (command && !command.startsWith("-")) {
      console.error(`Unknown command: ${command}`);
      console.error("Usage: mcp-slim [serve|observe|evolve|validate|status|init]");
      process.exit(1);
    }
    const { startServer: start } = await import(pathToFileURL(join(PKG_ROOT, "src", "server.js")).href);
    await start(getModulesDir());
}
