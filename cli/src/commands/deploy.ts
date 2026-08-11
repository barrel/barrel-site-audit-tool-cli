import { spawn } from "node:child_process";
import { join } from "node:path";
import chalk from "chalk";
import { findRepoRoot } from "../paths.js";

export interface DeployArgs {
  prod?: boolean;
}

export function deployCommand({ prod }: DeployArgs): Promise<void> {
  const webDir = join(findRepoRoot(), "web");
  const args = ["deploy", "--yes", ...(prod ? ["--prod"] : [])];

  console.log(chalk.bold(`Deploying report site to Vercel${prod ? " (production)" : " (preview)"}...\n`));

  return new Promise((resolve, reject) => {
    const child = spawn("vercel", args, { cwd: webDir, stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`vercel deploy exited with code ${code}`));
    });
    child.on("error", reject);
  });
}
