// iOS 本地构建的产物准备脚本。
//
// Tauri CLI 当前无法用 rename 覆盖已有的 `.app` 目录；这里只清理明确允许的、可再生成的
// 模拟器输出，避免影响 Xcode 工程、签名配置或其他平台产物。

import { readFile, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const outputVariant = process.argv[2];
const allowedVariants = new Set(["arm64-sim", "x86_64-sim"]);

if (!allowedVariants.has(outputVariant)) {
  throw new Error(`不允许清理未知的 iOS 构建变体：${outputVariant ?? "<missing>"}`);
}

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauriConfigPath = resolve(appRoot, "src-tauri", "tauri.conf.json");
const tauriConfig = JSON.parse(await readFile(tauriConfigPath, "utf8"));
const buildRoot = resolve(appRoot, "src-tauri", "gen", "apple", "build");
const outputPath = resolve(buildRoot, outputVariant, `${tauriConfig.productName}.app`);
const relativeOutput = relative(buildRoot, outputPath);

if (!relativeOutput || relativeOutput.startsWith("..") || isAbsolute(relativeOutput)) {
  throw new Error(`拒绝清理 iOS 构建目录之外的路径：${outputPath}`);
}

await rm(outputPath, { recursive: true, force: true });
