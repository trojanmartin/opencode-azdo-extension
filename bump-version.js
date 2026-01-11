#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs"
import { execSync } from "node:child_process"

const versionType = process.argv[2] || "patch"
const prerelease = process.argv[3]

if (!["major", "minor", "patch"].includes(versionType)) {
  console.error("Usage: node bump-version.js [major|minor|patch] [prerelease]")
  console.error("Examples:")
  console.error("  node bump-version.js patch        # 0.12.0 -> 0.12.1")
  console.error("  node bump-version.js minor        # 0.12.0 -> 0.13.0")
  console.error("  node bump-version.js patch beta   # 0.12.0 -> 0.12.1-beta")
  process.exit(1)
}

function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/)
  if (!match) throw new Error(`Invalid version: ${version}`)
  return {
    major: parseInt(match[1]),
    minor: parseInt(match[2]),
    patch: parseInt(match[3]),
    prerelease: match[4],
  }
}

function bumpVersion(version, type, prerelease) {
  const v = parseVersion(version)

  if (type === "major") {
    v.major++
    v.minor = 0
    v.patch = 0
  } else if (type === "minor") {
    v.minor++
    v.patch = 0
  } else if (type === "patch") {
    v.patch++
  }

  const base = `${v.major}.${v.minor}.${v.patch}`
  return prerelease ? `${base}-${prerelease}` : base
}

function run(cmd) {
  console.log(`> ${cmd}`)
  execSync(cmd, { stdio: "inherit" })
}

// Read current version
const pkg = JSON.parse(readFileSync("package.json", "utf8"))
const currentVersion = pkg.version
const newVersion = bumpVersion(currentVersion, versionType, prerelease)
const newVersionParts = parseVersion(newVersion)

console.log(`Bumping version: ${currentVersion} -> ${newVersion}`)

// Update package.json
pkg.version = newVersion
writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n")
console.log("Updated package.json")

// Update vss-extension.json
const vss = JSON.parse(readFileSync("vss-extension.json", "utf8"))
vss.version = newVersion
writeFileSync("vss-extension.json", JSON.stringify(vss, null, 2) + "\n")
console.log("Updated vss-extension.json")

// Update task.json (only Major.Minor.Patch, no prerelease)
const task = JSON.parse(readFileSync("tasks/opencode/task.json", "utf8"))
task.version.Major = newVersionParts.major
task.version.Minor = newVersionParts.minor
task.version.Patch = newVersionParts.patch
writeFileSync("tasks/opencode/task.json", JSON.stringify(task, null, 2) + "\n")
console.log("Updated tasks/opencode/task.json")

// Git operations
console.log("\nCommitting and tagging...")
run(`git add package.json vss-extension.json tasks/opencode/task.json`)
run(`git commit -m "chore: bump version to ${newVersion}"`)
run(`git tag v${newVersion}`)
run("git push")
run("git push --tags")

console.log(`\nSuccessfully bumped to ${newVersion} and pushed with tag v${newVersion}`)
