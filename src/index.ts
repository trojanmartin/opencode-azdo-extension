import * as tl from "azure-pipelines-task-lib/task"

import { resolveRunConfig } from "./common"
import { runCodeReview } from "./code-review"
import { runCommand } from "./command"

import type { RunMode } from "./common"
import { exit } from "node:process"

interface ParsedCommentUrl {
  organization: string
  repositoryId: string
  pullRequestId: number
  threadId: number
  commentId: number
}

function parseCommentUrl(url: string): ParsedCommentUrl {
  const regex =
    /^https:\/\/dev\.azure\.com\/([^/]+)\/_apis\/git\/repositories\/([^/]+)\/pullRequests\/(\d+)\/threads\/(\d+)\/comments\/(\d+)$/
  const match = url.match(regex)
  if (!match) {
    throw new Error(
      `Invalid comment URL format: ${url}. Expected format: https://dev.azure.com/{org}/_apis/git/repositories/{repoId}/pullRequests/{prId}/threads/{threadId}/comments/{commentId}`
    )
  }
  return {
    organization: match[1]!,
    repositoryId: match[2]!,
    pullRequestId: parseInt(match[3]!, 10),
    threadId: parseInt(match[4]!, 10),
    commentId: parseInt(match[5]!, 10),
  }
}

function extractOrganization(collectionUri: string): string {
  const devAzureMatch = collectionUri.match(/https:\/\/dev\.azure\.com\/([^/]+)/)
  if (devAzureMatch && devAzureMatch[1]) {
    return devAzureMatch[1]
  }

  const vsMatch = collectionUri.match(/https:\/\/([^.]+)\.visualstudio\.com/)
  if (vsMatch && vsMatch[1]) {
    return vsMatch[1]
  }

  throw new Error(`Unable to extract organization from Collection URI: ${collectionUri}`)
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

function getRequiredInput(name: string): string {
  const value = tl.getInput(name, true)
  if (!value) {
    throw new Error(`Required input '${name}' is not provided.`)
  }
  return value
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

async function main(): Promise<void> {
  try {
    const collectionUri = getRequiredVariable("System.CollectionUri")
    const buildId = tl.getVariable("Build.BuildId")

    const modeInput = tl.getInput("mode", false)
    const mode = modeInput ? (modeInput as RunMode) : undefined

    const commentUrl = tl.getInput("commentUrl", false)

    let organization: string
    let repositoryId: string
    let pullRequestId: number
    let threadId: number | undefined
    let commentId: number | undefined

    if (commentUrl) {
      const parsed = parseCommentUrl(commentUrl)
      organization = tl.getInput("organization", false) || parsed.organization
      repositoryId = tl.getInput("repositoryId", false) || parsed.repositoryId
      pullRequestId = parsed.pullRequestId
      threadId = parsed.threadId
      commentId = parsed.commentId

      const pullRequestIdInput = tl.getInput("pullRequestId", false)
      if (pullRequestIdInput) {
        pullRequestId = parseInt(pullRequestIdInput, 10)
        if (isNaN(pullRequestId)) {
          throw new Error("Pull Request ID must be a valid number.")
        }
      }
    } else {
      organization = tl.getInput("organization", false) || extractOrganization(collectionUri)
      repositoryId =
        tl.getInput("repositoryId", false) || getRequiredVariable("Build.Repository.Id")

      const pullRequestIdInput = tl.getInput("pullRequestId", false)
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

    const project = tl.getInput("project", false) || getRequiredVariable("System.TeamProject")
    const pat = getRequiredInput("pat")
    const providerID = getRequiredInput("providerID")
    const modelID = getRequiredInput("modelID")

    const agent = tl.getInput("agent", false) || "build"
    const workspacePath = tl.getInput("workspacePath", false) || getDefaultWorkspacePath()
    const skipClone = tl.getBoolInput("skipClone", false)
    const reviewPrompt = tl.getInput("reviewPrompt", false)

    if (skipClone && !workspacePath) {
      throw new Error("workspacePath must be provided when skipClone is enabled.")
    }

    console.log(`Organization: ${organization}`)
    console.log(`Project: ${project}`)
    console.log(`Repository ID: ${repositoryId}`)
    console.log(`Pull Request ID: ${pullRequestId}`)
    console.log(`Thread ID: ${threadId ?? "(none)"}`)
    console.log(`Comment ID: ${commentId ?? "(none)"}`)
    console.log(`Agent: ${agent}`)
    console.log(`Provider: ${providerID}`)
    console.log(`Model: ${modelID}`)
    console.log(`Mode: ${mode ?? "auto"}`)
    console.log(`Skip Clone: ${skipClone}`)
    console.log(`Review Prompt: ${reviewPrompt ? "(custom)" : "(default)"}`)

    const config = {
      repository: { organization, project, repositoryId },
      opencodeConfig: { agent, providerID, modelID },
      context: { pullRequestId, threadId, commentId },
      pat,
      workspacePath,
      buildId,
      collectionUri,
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
