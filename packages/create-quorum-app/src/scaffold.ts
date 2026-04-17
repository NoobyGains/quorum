// Pure scaffold routine for create-quorum-app: copies a template tree to a
// target directory, substitutes __APP_NAME__ in package.json files, and
// returns the POSIX-relative list of files created. No shell, no git.

import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";

import type { ScaffoldOptions, ScaffoldResult } from "./types.js";

const PLACEHOLDER = "__APP_NAME__";

export async function scaffold(opts: ScaffoldOptions): Promise<ScaffoldResult> {
  validateAppName(opts.appName);

  await validateTemplate(opts.templateDir);
  await validateTarget(opts.targetDir, opts.overwrite === true);

  await mkdir(opts.targetDir, { recursive: true });

  const created: string[] = [];
  await copyTree(opts.templateDir, opts.targetDir, opts.appName, created);

  const createdFiles = created
    .map((p) => p.split(sep).join("/"))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  return { createdFiles };
}

function validateAppName(appName: string): void {
  if (
    appName.length === 0 ||
    appName.includes("/") ||
    appName.includes("\\") ||
    appName.includes("..")
  ) {
    throw new Error(`invalid appName: ${JSON.stringify(appName)}`);
  }
}

async function validateTemplate(templateDir: string): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(templateDir, { withFileTypes: true });
  } catch {
    throw new Error(
      `template directory is empty or missing: ${templateDir}`,
    );
  }
  if (entries.length === 0) {
    throw new Error(
      `template directory is empty or missing: ${templateDir}`,
    );
  }
}

async function validateTarget(
  targetDir: string,
  overwrite: boolean,
): Promise<void> {
  let entries: Dirent[] | null;
  try {
    entries = await readdir(targetDir, { withFileTypes: true });
  } catch {
    entries = null;
  }
  if (entries && entries.length > 0 && !overwrite) {
    throw new Error(`target directory is not empty: ${targetDir}`);
  }
}

async function copyTree(
  srcDir: string,
  dstDir: string,
  appName: string,
  created: string[],
  rel = "",
): Promise<void> {
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const dstPath = join(dstDir, entry.name);
    const entryRel = rel === "" ? entry.name : join(rel, entry.name);

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      await mkdir(dstPath, { recursive: true });
      await copyTree(srcPath, dstPath, appName, created, entryRel);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (entry.name === "package.json") {
      const content = await readFile(srcPath, "utf8");
      const substituted = content.split(PLACEHOLDER).join(appName);
      await writeFile(dstPath, substituted, "utf8");
    } else {
      const bytes = await readFile(srcPath);
      await writeFile(dstPath, bytes);
    }

    created.push(entryRel);
  }
}
