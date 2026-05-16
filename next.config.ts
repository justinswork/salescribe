import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Version = MAJOR.MINOR (from package.json) . PATCH (auto-incrementing from git
// commit count). The baseline is the commit count at which we declared the
// versioning scheme — every commit after that increments the patch by 1.
// Set baseline to 12 so commit 13 displays as 0.1.1.
const VERSION_BASELINE_COMMITS = 12;

function readPackageVersion(): string {
  try {
    const raw = readFileSync(join(__dirname, "package.json"), "utf8");
    const v = (JSON.parse(raw) as { version?: string }).version ?? "0.1.0";
    const [major, minor] = v.split(".");
    return `${major}.${minor}`;
  } catch {
    return "0.1";
  }
}

function getVersion(): string {
  if (process.env.NEXT_PUBLIC_APP_VERSION) return process.env.NEXT_PUBLIC_APP_VERSION;
  const majorMinor = readPackageVersion();
  try {
    const count = Number(
      execSync("git rev-list --count HEAD", { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim(),
    );
    const patch = Math.max(0, count - VERSION_BASELINE_COMMITS);
    return `${majorMinor}.${patch}`;
  } catch {
    return `${majorMinor}.0-dev`;
  }
}

function getGitSha(): string {
  if (process.env.NEXT_PUBLIC_GIT_SHA) return process.env.NEXT_PUBLIC_GIT_SHA;
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "dev";
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: getVersion(),
    NEXT_PUBLIC_GIT_SHA: getGitSha(),
  },
};

export default nextConfig;
