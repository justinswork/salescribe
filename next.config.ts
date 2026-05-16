import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Version is the literal `version` field in package.json. Bump it with
// `npm version patch --no-git-tag-version` (or just edit by hand) to release a
// new build. We tried auto-incrementing from git commit count, but Firebase
// App Hosting clones the repo with shallow history, so the count is always 1
// in the build sandbox. Plain package.json is reliable on any clone depth.
function getVersion(): string {
  if (process.env.NEXT_PUBLIC_APP_VERSION) return process.env.NEXT_PUBLIC_APP_VERSION;
  try {
    const raw = readFileSync(join(__dirname, "package.json"), "utf8");
    return (JSON.parse(raw) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// Git SHA stays around for the hover tooltip on the version chip — useful for
// tracing a deployed instance back to a specific commit.
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
