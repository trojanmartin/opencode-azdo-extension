import process from "node:process"

import { resolveRunConfig } from "./common"
import { runCodeReview } from "./code-review"
import { runCommand } from "./command"

import type { RunConfig } from "./common"

function getConfig(): RunConfig {
  return {
    repository: {
      organization: "trojanmartin",
      project: "dependabot-test",
      repositoryId: "34a46682-797f-493e-8e73-117740e16341",
    },
    opencodeConfig: {
      agent: "build",
      providerID: "github-copilot",
      modelID: "gpt-4.1",
    },
    context: {
      pullRequestId: 1,
    },
    pat: "<>",
    mode: "review",
  }
}

async function main(): Promise<void> {
  try {
    const baseConfig = getConfig()
    const resolved = await resolveRunConfig(baseConfig)

    console.log(`Debug mode resolved: ${resolved.mode}`)

    if (resolved.mode === "review") {
      await runCodeReview(resolved)
    } else {
      await runCommand(resolved)
    }

    console.log("Debug run completed successfully")
  } catch (error) {
    console.error("Debug run failed:", (error as Error).message)
    process.exitCode = 1
  }
}

main()
