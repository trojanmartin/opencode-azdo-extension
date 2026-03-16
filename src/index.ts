import * as tl from "azure-pipelines-task-lib/task"

import { resolveRunConfig, type RunMode, type OpencodeConfig } from "./common"
import { runCodeReview } from "./code-review"
import { runCommand } from "./command"
import { exit } from "node:process"

interface ParsedCommentUrl {
  organization: string
  repositoryId: string
  pullRequestId: number
  threadId: number
  commentId: number
  collectionUrl: string
}

function parseCommentUrl(url: string): ParsedCommentUrl {
  // Cloud formats:
  // - https://dev.azure.com/{org}/_apis/...
  // - https://{org}.visualstudio.com/{project}/_apis/...

  // On-prem formats (Azure DevOps Server 2020+):
  // - http(s)://server:port/{collection}/_apis/...
  // - http(s)://server:port/tfs/{collection}/_apis/... (older versions)

  // Try cloud - dev.azure.com first
  const cloudRegex =
    /^https:\/\/dev\.azure\.com\/([^/]+)\/_apis\/git\/repositories\/([^/]+)\/pullRequests\/(\d+)\/threads\/(\d+)\/comments\/(\d+)$/
  const cloudMatch = url.match(cloudRegex)

  if (cloudMatch) {
    return {
      organization: cloudMatch[1]!,
      repositoryId: cloudMatch[2]!,
      pullRequestId: parseInt(cloudMatch[3]!, 10),
      threadId: parseInt(cloudMatch[4]!, 10),
      commentId: parseInt(cloudMatch[5]!, 10),
      collectionUrl: "https://dev.azure.com",
    }
  }

  // Cloud - visualstudio.com
  const vsRegex =
    /^https:\/\/([^.]+)\.visualstudio\.com\/([^/]+)\/_apis\/git\/repositories\/([^/]+)\/pullRequests\/(\d+)\/threads\/(\d+)\/comments\/(\d+)$/
  const vsMatch = url.match(vsRegex)

  if (vsMatch) {
    return {
      organization: vsMatch[1]!,
      repositoryId: vsMatch[3]!,
      pullRequestId: parseInt(vsMatch[4]!, 10),
      threadId: parseInt(vsMatch[5]!, 10),
      commentId: parseInt(vsMatch[6]!, 10),
      collectionUrl: `https://${vsMatch[1]}.visualstudio.com`,
    }
  }

  // On-prem with /tfs/ path (older Azure DevOps Server)
  const onPremTfsRegex =
    /^(https?):\/\/([^/]+)\/tfs\/([^/]+)\/_apis\/git\/repositories\/([^/]+)\/pullRequests\/(\d+)\/threads\/(\d+)\/comments\/(\d+)$/
  const onPremTfsMatch = url.match(onPremTfsRegex)

  if (onPremTfsMatch) {
    const protocol = onPremTfsMatch[1]!
    const host = onPremTfsMatch[2]!
    const collection = onPremTfsMatch[3]!
    return {
      organization: collection,
      repositoryId: onPremTfsMatch[4]!,
      pullRequestId: parseInt(onPremTfsMatch[5]!, 10),
      threadId: parseInt(onPremTfsMatch[6]!, 10),
      commentId: parseInt(onPremTfsMatch[7]!, 10),
      collectionUrl: `${protocol}://${host}/tfs/${collection}`,
    }
  }

  // On-prem without /tfs/ path (Azure DevOps Server 2020+)
  const onPremRegex =
    /^(https?):\/\/([^/]+)\/([^/]+)\/_apis\/git\/repositories\/([^/]+)\/pullRequests\/(\d+)\/threads\/(\d+)\/comments\/(\d+)$/
  const onPremMatch = url.match(onPremRegex)

  if (onPremMatch) {
    const protocol = onPremMatch[1]!
    const host = onPremMatch[2]!
    const collection = onPremMatch[3]!
    return {
      organization: collection,
      repositoryId: onPremMatch[4]!,
      pullRequestId: parseInt(onPremMatch[5]!, 10),
      threadId: parseInt(onPremMatch[6]!, 10),
      commentId: parseInt(onPremMatch[7]!, 10),
      collectionUrl: `${protocol}://${host}/${collection}`,
    }
  }

  throw new Error(
    `Invalid comment URL format: ${url}. Expected formats: https://dev.azure.com/{org}/..., https://{org}.visualstudio.com/..., or http(s)://server:port/{collection}/...`
  )
}

function extractOrganization(collectionUri: string): string {
  // Azure DevOps Services - dev.azure.com
  const devAzureMatch = collectionUri.match(/https:\/\/dev\.azure\.com\/([^/]+)/)
  if (devAzureMatch && devAzureMatch[1]) {
    return devAzureMatch[1]
  }

  // Azure DevOps Services - visualstudio.com
  const vsMatch = collectionUri.match(/https:\/\/([^.]+)\.visualstudio\.com/)
  if (vsMatch && vsMatch[1]) {
    return vsMatch[1]
  }

  // Azure DevOps Server (on-prem) - old format: http(s)://server:port/tfs/Collection
  const onPremTfsMatch = collectionUri.match(/https?:\/\/[^/]+\/tfs\/([^/]+)/)
  if (onPremTfsMatch && onPremTfsMatch[1]) {
    return onPremTfsMatch[1]
  }

  // Azure DevOps Server (on-prem) - new format: http(s)://server:port/Collection
  const onPremMatch = collectionUri.match(/https?:\/\/[^/]+\/([^/]+)/)
  if (onPremMatch && onPremMatch[1] && onPremMatch[1] !== "_apis") {
    return onPremMatch[1]
  }

  throw new Error(`Unable to extract organization from Collection URI: ${collectionUri}`)
}

function extractBaseUrl(collectionUri: string): string {
  // Azure DevOps Services - dev.azure.com
  const devAzureMatch = collectionUri.match(/(https:\/\/dev\.azure\.com)/)
  if (devAzureMatch && devAzureMatch[1]) {
    return devAzureMatch[1]
  }

  // Azure DevOps Services - visualstudio.com
  const vsMatch = collectionUri.match(/(https:\/\/[^.]+\.visualstudio\.com)/)
  if (vsMatch && vsMatch[1]) {
    return vsMatch[1]
  }

  // Azure DevOps Server (on-prem) - old format: /tfs/Collection
  const onPremTfsMatch = collectionUri.match(/(https?:\/\/[^/]+\/tfs\/[^/]+)/)
  if (onPremTfsMatch && onPremTfsMatch[1]) {
    return onPremTfsMatch[1]
  }

  // Azure DevOps Server (on-prem) - new format: /Collection (no /tfs/)
  const onPremMatch = collectionUri.match(/(https?:\/\/[^/]+\/[^/]+)/)
  if (onPremMatch && onPremMatch[1]) {
    return onPremMatch[1]
  }

  // Default fallback for common cloud format
  return "https://dev.azure.com"
}

function getRequiredVariable(name: string): string {
  const value = tl.getVariable(name)
  if (!value) {
    throw new Error(
      `Required variable '${name}' is not set. Ensure this task runs in the correct context.`
    )
  }
  return value
}

function getInputOrEnv(name: string, required: boolean): string | undefined {
  // Try task input first
  const inputValue = tl.getInput(name, required)
  if (inputValue) {
    return inputValue
  }

  // Fall back to environment variable for debugging (AZDO_INPUT_* prefix)
  const envKey = `AZDO_INPUT_${name.toUpperCase()}`
  const envValue = process.env[envKey]
  if (envValue) {
    return envValue
  }

  if (required) {
    throw new Error(`Required input '${name}' is not provided.`)
  }
  return undefined
}

function getBoolInputOrEnv(name: string): boolean {
  // Try task input first
  const inputValue = tl.getBoolInput(name, false)
  if (inputValue !== undefined) {
    return inputValue
  }

  // Fall back to environment variable for debugging
  const envKey = `AZDO_INPUT_${name.toUpperCase()}`
  const envValue = process.env[envKey]
  return envValue === "true"
}

function getRequiredInput(name: string): string {
  return getInputOrEnv(name, true) as string
}

function getDefaultWorkspacePath(): string {
  const binariesDir = tl.getVariable("Build.BinariesDirectory")
  if (binariesDir) {
    return binariesDir
  }

  const tempDir = tl.getVariable("Agent.TempDirectory")
  if (tempDir) {
    return tempDir
  }

  return "./workspace"
}

function ResolveOpenCodeConfig(agent: string | undefined, model: string): OpencodeConfig {
  const [providerID, ...rest] = model.split("/")
  const modelID = rest.join("/")

  if (!providerID?.length || !modelID.length)
    throw new Error(`Invalid model ${model}. Model must be in the format "provider/model".`)
  return { agent, providerID, modelID }
}

async function main(): Promise<void> {
  try {
    const collectionUri = getRequiredVariable("System.CollectionUri")
    const buildId = tl.getVariable("Build.BuildId")

    const modeInput = getInputOrEnv("mode", false)
    const mode = modeInput ? (modeInput as RunMode) : undefined

    const commentUrl = getInputOrEnv("commentUrl", false)

    let organization: string
    let repositoryId: string
    let pullRequestId: number
    let threadId: number | undefined
    let commentId: number | undefined
    let collectionUrl: string

    if (commentUrl) {
      const parsed = parseCommentUrl(commentUrl)
      organization = getInputOrEnv("organization", false) || parsed.organization
      repositoryId = getInputOrEnv("repositoryId", false) || parsed.repositoryId
      pullRequestId = parsed.pullRequestId
      threadId = parsed.threadId
      commentId = parsed.commentId
      collectionUrl = getInputOrEnv("collectionUrl", false) || parsed.collectionUrl

      const pullRequestIdInput = getInputOrEnv("pullRequestId", false)
      if (pullRequestIdInput) {
        pullRequestId = parseInt(pullRequestIdInput, 10)
        if (isNaN(pullRequestId)) {
          throw new Error("Pull Request ID must be a valid number.")
        }
      }
    } else {
      organization = getInputOrEnv("organization", false) || extractOrganization(collectionUri)
      repositoryId =
        getInputOrEnv("repositoryId", false) || getRequiredVariable("Build.Repository.Id")
      collectionUrl = getInputOrEnv("collectionUrl", false) || extractBaseUrl(collectionUri)

      const pullRequestIdInput = getInputOrEnv("pullRequestId", false)
      pullRequestId = pullRequestIdInput
        ? parseInt(pullRequestIdInput, 10)
        : parseInt(getRequiredVariable("System.PullRequest.PullRequestId"), 10)

      if (isNaN(pullRequestId)) {
        throw new Error("Pull Request ID must be a valid number.")
      }

      threadId = undefined
      commentId = undefined
    }

    if (!mode && !commentUrl) {
      throw new Error(
        "commentUrl is required when 'mode' is not specified. Provide commentUrl or set mode explicitly to 'review'."
      )
    }

    if (mode === "command" && !commentUrl) {
      throw new Error("commentUrl is required for command mode.")
    }

    const project = getInputOrEnv("project", false) || getRequiredVariable("System.TeamProject")
    const pat = getRequiredInput("pat")
    const model = getRequiredInput("model")

    const agent = getInputOrEnv("agent", false) || undefined
    const workspacePath = getInputOrEnv("workspacePath", false) || getDefaultWorkspacePath()
    const skipClone = getBoolInputOrEnv("skipClone")
    const reviewPrompt = getInputOrEnv("reviewPrompt", false)

    if (skipClone && !workspacePath) {
      throw new Error("workspacePath must be provided when skipClone is enabled.")
    }

    console.log(`Organization: ${organization}`)
    console.log(`Collection URL: ${collectionUrl}`)
    console.log(`Project: ${project}`)
    console.log(`Repository ID: ${repositoryId}`)
    console.log(`Pull Request ID: ${pullRequestId}`)
    console.log(`Thread ID: ${threadId ?? "(none)"}`)
    console.log(`Comment ID: ${commentId ?? "(none)"}`)
    console.log(`Agent: ${agent}`)
    console.log(`Model: ${model}`)
    console.log(`Mode: ${mode ?? "auto"}`)
    console.log(`Skip Clone: ${skipClone}`)
    console.log(`Review Prompt: ${reviewPrompt ? "(custom)" : "(default)"}`)

    const config = {
      repository: { organization, project, repositoryId },
      opencodeConfig: ResolveOpenCodeConfig(agent, model),
      context: { pullRequestId, threadId, commentId },
      pat,
      workspacePath,
      buildId,
      collectionUrl,
      mode,
      skipClone,
      reviewPrompt,
    }

    const resolved = await resolveRunConfig(config)

    if (resolved.mode === "review") {
      await runCodeReview(resolved)
    } else {
      await runCommand(resolved)
    }

    tl.setResult(tl.TaskResult.Succeeded, "OpenCode run completed successfully")
    exit(0)
  } catch (err) {
    tl.setResult(tl.TaskResult.Failed, (err as Error).message)
    exit(1)
  }
}

main()
