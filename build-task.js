import esbuild from "esbuild"
import { rmSync, mkdirSync, readFileSync, writeFileSync, cpSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

console.log("🚀 Building OpenCode Azure DevOps Task...")
console.log("=".repeat(60))

// Clean output directory
const taskDistDir = join(__dirname, "tasks", "opencode", "dist")
console.log("📁 Cleaning output directory...")
rmSync(taskDistDir, { recursive: true, force: true })
mkdirSync(taskDistDir, { recursive: true })

// Build with esbuild
console.log("🔨 Bundling task with esbuild...")
console.log("  - Platform: node")
console.log("  - Target: node20")
console.log("  - Format: cjs (CommonJS)")
console.log("  - Bundle: true (all dependencies included)")
console.log("  - Minify: true")
console.log("  - Sourcemap: true")
console.log("-".repeat(60))

try {
  const result = await esbuild.build({
    entryPoints: [join(__dirname, "src", "index.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs", // CommonJS for Azure DevOps compatibility
    outfile: join(taskDistDir, "index.js"),
    external: [], // Bundle everything - self-contained task
    sourcemap: true,
    minify: true,
    treeShaking: true,
    legalComments: "none",
    mainFields: ["main", "module"],
    conditions: ["import", "require", "node"],
    logLevel: "info",
    logOverride: {
      "this-is-undefined-in-esm": "silent",
      "missing-sourcemap-warning": "silent",
    },
    // Inject __dirname and __filename for CJS compatibility (ESM source uses these)
    banner: {
      js: `var __filename = __filename || "";var __dirname = __dirname || require("path").dirname(__filename);`,
    },
  })

  console.log("✅ esbuild completed successfully!")
  console.log("-".repeat(60))

  // Copy additional files that might be needed
  console.log("📄 Copying additional files...")

  // Copy package.json for reference
  const packageJson = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf-8"))
  const taskPackageJson = {
    name: "opencode-agent",
    version: packageJson.version,
    description: "Azure DevOps task for OpenCode AI integration",
    main: "index.js",
    type: "commonjs",
    dependencies: {}, // Bundled, so no external dependencies needed
    devDependencies: {},
  }
  writeFileSync(join(taskDistDir, "package.json"), JSON.stringify(taskPackageJson, null, 2))
  console.log("  - package.json")

  // Copy review script
  const reviewScriptSource = join(__dirname, "src", "scripts", "add-review-comment.mjs")
  const reviewScriptDestDir = join(taskDistDir, "scripts")
  const reviewScriptDest = join(reviewScriptDestDir, "add-review-comment.mjs")
  mkdirSync(reviewScriptDestDir, { recursive: true })
  cpSync(reviewScriptSource, reviewScriptDest, { force: true })
  console.log("  - scripts/add-review-comment.mjs")

  // Verify bundle
  const stats = result.stats || { meta: { outputs: [] } }
  let totalSize = 0
  for (const output of result.outputFiles || []) {
    const size = output.contents.length
    totalSize += size
    console.log(`  - ${output.path}: ${(size / 1024).toFixed(2)} KB`)
  }

  console.log("=".repeat(60))
  console.log("📦 Task bundle created successfully!")
  console.log(`📊 Total bundle size: ${(totalSize / 1024).toFixed(2)} KB`)
  console.log(`📁 Output directory: ${taskDistDir}`)
  console.log("")
  console.log("💡 The task is now self-contained and includes all")
  console.log("   dependencies. No external npm packages needed!")
  console.log("")
  console.log("Ready to package with: npm run package")
  console.log("=".repeat(60))
} catch (error) {
  console.error("❌ Build failed!")
  console.error(error)
  process.exit(1)
}
