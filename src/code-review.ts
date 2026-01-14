import { join, dirname } from "node:path"
import { promises as fs } from "node:fs"
import { fileURLToPath } from "node:url"

import {
  addPullRequestComment,
  createPullRequestThread,
  editPullRequestComment,
  getPullRequest,
  getPullRequestIterationChanges,
  getPullRequestIterations,
  getPullRequestThreads,
} from "./azure-devops-api"
import {
  buildPrDataContext,
  cleanupWorkspace,
  getCommentFooter,
  pathExists,
  validateTrigger,
} from "./common"
import {
  assertOpencodeInstalled,
  createOpencodeInstance,
  sendPrompt,
  subscribeToSessionEvents,
  waitForConnection,
} from "./opencode"
import { cloneRepo } from "./git"
import { buildCodeReviewPrompt } from "./prompts/code-review-prompt"

import type { PullRequestThreadType, ResolvedRunConfig } from "./common"

const REVIEW_SCRIPT_NAME = "add-review-comment.mjs"

// __dirname is injected by esbuild banner for CJS compatibility
declare const __dirname: string
const getCurrentDirname = (): string => {
  if (typeof __dirname !== "undefined") {
    return __dirname
  }
  // ESM fallback
  return dirname(fileURLToPath(import.meta.url))
}

async function resolveReviewScriptSourcePath(): Promise<string> {
  const candidates = [
    join(getCurrentDirname(), "scripts", REVIEW_SCRIPT_NAME),
    join(getCurrentDirname(), "..", "scripts", REVIEW_SCRIPT_NAME),
    join(getCurrentDirname(), "..", "src", "scripts", REVIEW_SCRIPT_NAME),
    join(getCurrentDirname(), "..", "..", "scripts", REVIEW_SCRIPT_NAME),
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
  const destinationPath = join(workspaceDir, REVIEW_SCRIPT_NAME)
  await fs.copyFile(sourcePath, destinationPath)
  return REVIEW_SCRIPT_NAME
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
    reviewPrompt,
  } = config
  const { organization, project, repositoryId } = repository
  const { pullRequestId, threadId, commentId } = context
  const { comment } = triggerContext
  const commentTrigger = !comment

  let opencode: ReturnType<typeof createOpencodeInstance> | null = null
  let workspace: string | null = null
  let cleanupWorkspaceDir = false
  let replyCommentId: number | null = null

  try {
    await assertOpencodeInstalled()
    console.log("Starting code-review run...")
    if (!commentTrigger) {
      validateTrigger(comment!.content, "review")
    }

    const footer = getCommentFooter(organization, project, buildId)
    let contextThreads: PullRequestThreadType[] = []

    if (!commentTrigger) {
      const replyComment = await addPullRequestComment(
        organization,
        project,
        repositoryId,
        pullRequestId,
        threadId!,
        pat,
        `Reviewing pull request...${footer}`,
        commentId
      )
      replyCommentId = replyComment.id || null
      console.log("Added 'reviewing pull request' reply")
    }

    const [pr, iterationsData, allThreads] = await Promise.all([
      getPullRequest(organization, project, pullRequestId, pat, { includeCommits: true }),
      getPullRequestIterations(organization, project, repositoryId, pullRequestId, pat),
      getPullRequestThreads(organization, project, repositoryId, pullRequestId, pat),
    ])

    contextThreads = allThreads.value

    const latestIterationId = Math.max(...iterationsData.value.map((i) => i.id))
    const changesData = await getPullRequestIterationChanges(
      organization,
      project,
      repositoryId,
      pullRequestId,
      latestIterationId,
      pat
    )

    if (skipClone) {
      if (!workspacePath) {
        throw new Error("workspacePath is required when skipClone is enabled")
      }
      workspace = workspacePath
      console.log(`Using existing workspace: ${workspace}`)
    } else {
      const sourceBranch = pr.sourceRefName.replace("refs/heads/", "")
      await cleanupWorkspace(workspacePath)
      workspace = await cloneRepo({
        organization,
        project,
        repositoryId,
        branch: sourceBranch,
        pat,
        workspacePath,
      })
      cleanupWorkspaceDir = true
    }

    const scriptPath = await copyReviewScriptToWorkspace(workspace)

    const contextData = buildPrDataContext(pr, contextThreads, changesData.changeEntries)
    const prompt = buildCodeReviewPrompt({
      toolPath: scriptPath,
      contextData,
      customPrompt: reviewPrompt,
    })

    console.log("\n--- Review Prompt ---")
    console.log(prompt)
    console.log("--- End Review Prompt ---\n")

    process.env["AZURE_DEVOPS_ORG"] = organization
    process.env["AZURE_DEVOPS_PROJECT"] = project
    process.env["AZURE_DEVOPS_REPO_ID"] = repositoryId
    process.env["AZURE_DEVOPS_PR_ID"] = String(pullRequestId)
    process.env["AZURE_DEVOPS_PAT"] = pat

    opencode = createOpencodeInstance(workspace)

    await waitForConnection(opencode.client)
    console.log("Connected to opencode server")

    const sessionResp = await opencode.client.session.create<true>()
    const session = sessionResp.data

    subscribeToSessionEvents(opencode.server, session)

    const response = await sendPrompt(opencode.client, session, prompt, opencodeConfig)

    if (!commentTrigger && replyCommentId && threadId) {
      await editPullRequestComment(
        organization,
        project,
        repositoryId,
        pullRequestId,
        threadId,
        replyCommentId,
        pat,
        `${response}${footer}`
      )
    }
  } catch (err) {
    console.error("Error during review mode run:", (err as Error).message)

    const footer = getCommentFooter(organization, project, buildId)
    const errorMessage = `## OpenCode Review Summary\n\nReview failed: ${(err as Error).message}${footer}`

    if (!commentTrigger && replyCommentId && threadId) {
      await editPullRequestComment(
        organization,
        project,
        repositoryId,
        pullRequestId,
        threadId,
        replyCommentId,
        pat,
        errorMessage
      )
    } else {
      await createPullRequestThread(
        organization,
        project,
        repositoryId,
        pullRequestId,
        pat,
        errorMessage,
        { status: "fixed" }
      )
    }

    throw err
  } finally {
    if (opencode) {
      console.log("Closing opencode server...")
      opencode.server.process.kill()
    }
    if (cleanupWorkspaceDir && workspace) {
      await cleanupWorkspace(workspace)
    }
  }
}
