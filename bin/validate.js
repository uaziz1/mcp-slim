/**
 * Module validator for mcp-slim.
 *
 * Validates that modules:
 *   1. Have valid JavaScript syntax (can be imported)
 *   2. Export { tools: [...], handlers: {...} }
 *   3. Every tool name has a matching handler
 *   4. Every handler has a matching tool definition
 *   5. No tool name collides with other modules
 */

import { readdir } from "fs/promises";
import { basename, join, resolve } from "path";
import { pathToFileURL } from "url";

const SKIP_FILES = new Set(["shared.js"]);

function isModuleFile(filename) {
  return filename.endsWith(".js") && !filename.startsWith("_") && !filename.endsWith(".example.js") && !SKIP_FILES.has(filename);
}

async function loadAllToolNames(modulesDir, excludeFile = null) {
  const names = new Set();
  let files;
  try {
    files = (await readdir(modulesDir)).filter(isModuleFile);
  } catch {
    return names;
  }

  for (const file of files) {
    if (excludeFile && file === excludeFile) continue;
    try {
      const mod = await import(pathToFileURL(join(modulesDir, file)).href);
      const def = mod.default;
      if (def && Array.isArray(def.tools)) {
        for (const tool of def.tools) {
          if (tool.name) names.add(tool.name);
        }
      }
    } catch { /* skip modules that fail to load */ }
  }
  return names;
}

async function validateModule(filePath, modulesDir) {
  const errors = [];
  const filename = basename(filePath);

  // 1. Try to import
  let mod;
  try {
    mod = await import(pathToFileURL(resolve(filePath)).href);
  } catch (err) {
    errors.push(`Import failed: ${err.message}`);
    return errors;
  }

  const def = mod.default;
  if (!def) {
    errors.push("No default export found");
    return errors;
  }

  // 2. Check tools array
  if (!Array.isArray(def.tools)) {
    errors.push(`'tools' is not an array (got ${typeof def.tools})`);
  } else {
    for (let i = 0; i < def.tools.length; i++) {
      const tool = def.tools[i];
      if (!tool || typeof tool !== "object") {
        errors.push(`tools[${i}] is not a valid object`);
        continue;
      }
      if (!tool.name) errors.push(`tools[${i}] missing 'name'`);
      if (!tool.description) errors.push(`tools[${i}] missing 'description'`);
      if (!tool.inputSchema) errors.push(`tools[${i}] missing 'inputSchema'`);
    }
  }

  // 3. Check handlers object
  if (!def.handlers || typeof def.handlers !== "object") {
    errors.push(`'handlers' is not an object (got ${typeof def.handlers})`);
  }

  // 4. Cross-check tools <-> handlers
  if (Array.isArray(def.tools) && def.handlers && typeof def.handlers === "object") {
    for (const tool of def.tools) {
      if (tool.name && typeof def.handlers[tool.name] !== "function") {
        errors.push(`Tool '${tool.name}' has no handler function`);
      }
    }
    const toolNames = new Set(def.tools.map(t => t.name));
    for (const handlerName of Object.keys(def.handlers)) {
      if (!toolNames.has(handlerName)) {
        errors.push(`Handler '${handlerName}' has no tool definition`);
      }
    }
  }

  // 5. Name collisions
  if (Array.isArray(def.tools) && modulesDir) {
    const existingNames = await loadAllToolNames(modulesDir, filename);
    for (const tool of def.tools) {
      if (tool.name && existingNames.has(tool.name)) {
        errors.push(`Tool name '${tool.name}' collides with an existing module`);
      }
    }
  }

  return errors;
}

export async function runValidator(target) {
  let filesToValidate = [];

  if (target.endsWith(".js")) {
    // Single file
    filesToValidate = [resolve(target)];
  } else {
    // Directory
    try {
      const files = (await readdir(target)).filter(isModuleFile);
      filesToValidate = files.map(f => join(target, f));
    } catch {
      console.error(`Cannot read directory: ${target}`);
      process.exit(1);
    }
  }

  if (!filesToValidate.length) {
    console.log("No modules found to validate.");
    return;
  }

  let allPassed = true;

  for (const filePath of filesToValidate) {
    const modulesDir = filePath.endsWith(".js") ? resolve(filePath, "..") : target;
    const errors = await validateModule(filePath, modulesDir);
    const name = basename(filePath);

    if (errors.length === 0) {
      console.log(`PASS  ${name}`);
    } else {
      console.log(`FAIL  ${name}`);
      for (const err of errors) {
        console.error(`  - ${err}`);
      }
      allPassed = false;
    }
  }

  if (!allPassed) process.exit(1);
}
