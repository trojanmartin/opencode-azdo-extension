import * as tl from "azure-pipelines-task-lib/task"
import { run } from "./runner.js"

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

function getNumericInput(name: string): number {
  const value = getRequiredInput(name)
  const parsed = parseInt(value, 10)
  if (isNaN(parsed)) {
    throw new Error(`Input '${name}' must be a valid number. Got: '${value}'`)
  }
  return parsed
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
    const organization = tl.getInput("organization", false) || extractOrganization(collectionUri)
    const project = tl.getInput("project", false) || getRequiredVariable("System.TeamProject")
    const repositoryId =
      tl.getInput("repositoryId", false) || getRequiredVariable("Build.Repository.Id")

    const pullRequestIdInput = tl.getInput("pullRequestId", false)
    const pullRequestId = pullRequestIdInput
      ? parseInt(pullRequestIdInput, 10)
      : parseInt(getRequiredVariable("System.PullRequest.PullRequestId"), 10)

    if (isNaN(pullRequestId)) {
      throw new Error("Pull Request ID must be a valid number.")
    }

    const threadId = getNumericInput("threadId")
    const commentId = getNumericInput("commentId")
    const pat = getRequiredInput("pat")
    const providerID = getRequiredInput("providerID")
    const modelID = getRequiredInput("modelID")

    const agent = tl.getInput("agent", false) || "build"
    const workspacePath = tl.getInput("workspacePath", false) || getDefaultWorkspacePath()

    console.log(`Organization: ${organization}`)
    console.log(`Project: ${project}`)
    console.log(`Repository ID: ${repositoryId}`)
    console.log(`Pull Request ID: ${pullRequestId}`)
    console.log(`Thread ID: ${threadId}`)
    console.log(`Comment ID: ${commentId}`)
    console.log(`Agent: ${agent}`)
    console.log(`Provider: ${providerID}`)
    console.log(`Model: ${modelID}`)

    await run({
      repository: { organization, project, repositoryId },
      opencodeConfig: { agent, providerID, modelID },
      context: { pullRequestId, threadId, commentId },
      pat,
      workspacePath,
    })

    tl.setResult(tl.TaskResult.Succeeded, "OpenCode review completed successfully")
  } catch (err) {
    tl.setResult(tl.TaskResult.Failed, (err as Error).message)
  }
}

main()
