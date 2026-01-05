import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { promises as fs } from "node:fs"

import {
  addPullRequestComment,
  editPullRequestComment,
  getPullRequest,
  getPullRequestIterationChanges,
  getPullRequestIterations,
  getPullRequestThread,
} from "./azure-devops-api.js"
import {
  buildDataContext,
  cleanupWorkspace,
  delay,
  getCommentFooter,
  pathExists,
  resolveOrganization,
  validateTrigger,
} from "./common.js"
import {
  assertOpencodeInstalled,
  createOpencodeInstance,
  sendPrompt,
  subscribeToSessionEvents,
  waitForConnection,
} from "./opencode.js"
import { cloneRepo, setupGitConfig } from "./git.js"
import { buildCodeReviewPrompt } from "./prompts/code-review-prompt.js"

import type { ResolvedRunConfig } from "./common.js"

const REVIEW_SCRIPT_NAME = "add-review-comment.sh"
const REVIEW_SCRIPT_DEST_SUBDIR = [".opencode", "scripts"]

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

async function resolveReviewScriptSourcePath(): Promise<string> {
  const candidates = [
    join(__dirname, "scripts", REVIEW_SCRIPT_NAME),
    join(__dirname, "..", "scripts", REVIEW_SCRIPT_NAME),
    join(__dirname, "..", "src", "scripts", REVIEW_SCRIPT_NAME),
    join(__dirname, "..", "..", "scripts", REVIEW_SCRIPT_NAME),
  ]

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate
    }
  }

  throw new Error(
    `Unable to locate ${REVIEW_SCRIPT_NAME}. Ensure it is bundled within a 'scripts' directory next to the task runtime.`
  )
}

async function copyReviewScriptToWorkspace(workspaceDir: string): Promise<string> {
  const sourcePath = await resolveReviewScriptSourcePath()
  const destinationDir = join(workspaceDir, ...REVIEW_SCRIPT_DEST_SUBDIR)
  await fs.mkdir(destinationDir, { recursive: true })

  const destinationPath = join(destinationDir, REVIEW_SCRIPT_NAME)
  await fs.copyFile(sourcePath, destinationPath)
  try {
    await fs.chmod(destinationPath, 0o755)
  } catch (error) {
    console.warn(
      `Failed to set executable permissions on ${destinationPath}: ${(error as Error).message}`
    )
  }

  return destinationPath
}

export async function runCodeReview(config: ResolvedRunConfig): Promise<void> {
  const {
    repository,
    context,
    pat,
    workspacePath = "./workspace",
    buildId,
    skipClone,
    triggerContext,
    opencodeConfig,
  } = config
  const organization = resolveOrganization(config)
  const { project, repositoryId } = repository

  if (!organization) {
    throw new Error("Unable to determine organization for review run.")
  }
  const { pullRequestId, threadId, commentId } = context
  const { comment } = triggerContext

  let opencode: ReturnType<typeof createOpencodeInstance> | null = null
  let workspace: string | null = null
  let cleanupWorkspaceDir = false

  try {
    await assertOpencodeInstalled()
    console.log("Starting review mode run...")
    console.log(`PR #${pullRequestId}, Thread #${threadId}, Comment #${commentId}`)

    validateTrigger(comment.content, "review")

    const footer = getCommentFooter(organization, project, buildId)
    const replyComment = await addPullRequestComment(
      organization,
      project,
      repositoryId,
      pullRequestId,
      threadId,
      pat,
      `Reviewing pull request...${footer}`,
      commentId
    )
    console.log("Added 'reviewing pull request' reply")

    const [pr, iterationsData, threadChanges] = await Promise.all([
      getPullRequest(organization, project, pullRequestId, pat, { includeCommits: true }),
      getPullRequestIterations(organization, project, repositoryId, pullRequestId, pat),
      getPullRequestThread(organization, project, repositoryId, pullRequestId, threadId, pat),
    ])

    const latestIterationId = Math.max(...iterationsData.value.map((i) => i.id))
    const changesData = await getPullRequestIterationChanges(
      organization,
      project,
      repositoryId,
      pullRequestId,
      latestIterationId,
      pat
    )

    const contextData = buildDataContext(pr, threadChanges, changesData.changeEntries)

    if (skipClone) {
      if (!workspacePath) {
        throw new Error("workspacePath is required when skipClone is enabled")
      }
      workspace = workspacePath
      console.log(`Using existing workspace: ${workspace}`)
    } else {
      const sourceBranch = pr.sourceRefName.replace("refs/heads/", "")
      workspace = await cloneRepo({
        organization,
        project,
        repositoryId,
        branch: sourceBranch,
        pat,
        workspacePath,
      })
      cleanupWorkspaceDir = true
      await setupGitConfig(workspace)
    }

    const scriptPath = await copyReviewScriptToWorkspace(workspace)

    const reviewEnv = {
      AZURE_DEVOPS_ORG: organization,
      AZURE_DEVOPS_PROJECT: project,
      AZURE_DEVOPS_REPO_ID: repositoryId,
      AZURE_DEVOPS_PR_ID: String(pullRequestId),
      AZURE_DEVOPS_PAT: pat,
    }

    const prompt = buildCodeReviewPrompt({
      changedFiles: changesData.changeEntries.map((entry) => ({
        path: entry.item.path,
        changeType: entry.changeType,
      })),
      prTitle: pr.title,
      prDescription: pr.description,
      toolPath: scriptPath,
      contextData,
    })

    console.log("\n--- Review Prompt ---")
    console.log(prompt)
    console.log("--- End Review Prompt ---\n")

    opencode = createOpencodeInstance(workspace, reviewEnv)

    await waitForConnection(opencode.client)
    console.log("Connected to opencode server")

    const sessionResp = await opencode.client.session.create<true>()
    const session = sessionResp.data

    subscribeToSessionEvents(opencode.server, session)

    const response = await sendPrompt(opencode.client, session, prompt, opencodeConfig)

    await editPullRequestComment(
      organization,
      project,
      repositoryId,
      pullRequestId,
      threadId,
      replyComment.id!,
      pat,
      `${response}${footer}`
    )
  } catch (err) {
    console.error("Error during review mode run:", (err as Error).message)
    throw err
  } finally {
    if (opencode) {
      console.log("Closing opencode server...")
      opencode.server.process.kill()
      await delay(1000)
    }
    if (cleanupWorkspaceDir && workspace) {
      await cleanupWorkspace(workspace)
    }
  }
}
