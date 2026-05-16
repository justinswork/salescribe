import type { NextConfig } from "next";
import { execSync } from "node:child_process";

// Capture the git short SHA at build time so the running app can self-identify.
// Falls back to NEXT_PUBLIC_GIT_SHA env var (if set by the build platform) or "dev"
// for local builds outside a git checkout.
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
    NEXT_PUBLIC_GIT_SHA: getGitSha(),
  },
};

export default nextConfig;
