import { promises as fs } from "node:fs"

import type {
  getPullRequest,
  getPullRequestIterationChanges,
  getPullRequestIterations,
} from "./azure-devops-api.js"
import { getPullRequestThread } from "./azure-devops-api.js"

export type RunMode = "command" | "review"

export interface OpencodeConfig {
  agent: string
  providerID: string
  modelID: string
}

export interface RepositoryInfo {
  organization: string
  project: string
  repositoryId: string
}

export interface PrRunContext {
  pullRequestId: number
  threadId?: number
  commentId?: number
}

export interface TriggerContext {
  thread?: PullRequestThreadType
  comment?: ThreadComment
}

export interface RunConfig {
  repository: RepositoryInfo
  opencodeConfig: OpencodeConfig
  context: PrRunContext
  pat: string
  workspacePath?: string
  buildId?: string
  collectionUri?: string
  mode?: RunMode
  skipClone?: boolean
}

export interface ResolvedRunConfig extends RunConfig {
  triggerContext: TriggerContext
  mode: RunMode
  explicitMode?: boolean
}

export const REVIEW_TRIGGER_KEYWORDS = ["/oc-review", "/opencode-review"]
export const COMMAND_TRIGGER_KEYWORDS = ["/oc", "/opencode"]

export type PullRequestThreadType = Awaited<ReturnType<typeof getPullRequestThread>>
export type ThreadComment = PullRequestThreadType["comments"][number]
export type PullRequestType = Awaited<ReturnType<typeof getPullRequest>>
export type PullRequestChangesType = Awaited<
  ReturnType<typeof getPullRequestIterationChanges>
>["changeEntries"]
export type PullRequestIterationsType = Awaited<ReturnType<typeof getPullRequestIterations>>

export async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

export function getCommentFooter(
  organization: string | undefined,
  project: string,
  buildId?: string
): string {
  if (!buildId || !organization) {
    return ""
  }

  const url = `https://dev.azure.com/${organization}/${project}/_build/results?buildId=${buildId}`
  return `\n\n---\n**Pipeline:** [Build #${buildId}](${url})`
}

export function includesAnyKeyword(content: string, keywords: string[]): boolean {
  const lowerContent = content.toLowerCase()
  return keywords.some((keyword) => lowerContent.includes(keyword))
}

export function detectModeFromComment(content: string): RunMode | null {
  if (includesAnyKeyword(content, REVIEW_TRIGGER_KEYWORDS)) {
    return "review"
  }
  if (includesAnyKeyword(content, COMMAND_TRIGGER_KEYWORDS)) {
    return "command"
  }
  return null
}

export function validateTrigger(content: string, mode: RunMode): void {
  const hasReview = includesAnyKeyword(content, REVIEW_TRIGGER_KEYWORDS)
  const hasCommand = includesAnyKeyword(content, COMMAND_TRIGGER_KEYWORDS)

  if (mode === "review") {
    if (!hasReview) {
      throw new Error(
        "Comment does not contain review trigger keyword ('/oc-review' or '/opencode-review')"
      )
    }
    return
  }

  if (hasReview) {
    throw new Error("Comment contains review trigger. Set mode to 'review' to perform code review.")
  }
  if (!hasCommand) {
    throw new Error("Comment does not contain trigger keyword ('/oc' or '/opencode')")
  }
}

export async function resolveModeFromComment(
  triggerContext: TriggerContext,
  explicitMode?: RunMode
): Promise<RunMode> {
  if (explicitMode) {
    return explicitMode
  }

  if (!triggerContext.comment) {
    throw new Error(
      "Cannot infer execution mode without a trigger comment. Provide 'mode' explicitly in the task inputs."
    )
  }

  const inferred = detectModeFromComment(triggerContext.comment.content)
  if (!inferred) {
    throw new Error(
      "Could not infer execution mode. Please add '/oc' for command mode or '/oc-review' for review mode in the trigger comment."
    )
  }
  return inferred
}

export async function resolveRunConfig(config: RunConfig): Promise<ResolvedRunConfig> {
  const { repository, context, pat } = config
  const { organization, project, repositoryId } = repository

  if (!project) {
    throw new Error("Repository project is required to run the task.")
  }

  if (!repositoryId) {
    throw new Error("Repository ID is required to run the task.")
  }

  const resolvedRepository = {
    ...repository,
    organization,
  }

  const hasTriggerIds = context.threadId !== undefined && context.commentId !== undefined
  const explicitMode = config.mode !== undefined
  const triggerContext: TriggerContext = {}

  if (hasTriggerIds) {
    const thread = await getPullRequestThread(
      resolvedRepository.organization,
      resolvedRepository.project,
      resolvedRepository.repositoryId,
      context.pullRequestId,
      context.threadId!,
      pat
    )

    const comment = thread.comments.find((c) => c.id === context.commentId)
    if (!comment) {
      throw new Error(`Comment #${context.commentId} not found in thread #${context.threadId}`)
    }

    triggerContext.thread = thread
    triggerContext.comment = comment
  } else if (!explicitMode) {
    throw new Error(
      "threadId and commentId inputs are required when 'mode' is not specified. Provide these inputs or set the mode explicitly."
    )
  }

  const mode = await resolveModeFromComment(triggerContext, config.mode)

  if (!explicitMode) {
    if (!triggerContext.comment) {
      throw new Error("Trigger comment is required to validate mode when auto-detected.")
    }
    validateTrigger(triggerContext.comment.content, mode)
  }

  return {
    ...config,
    repository: resolvedRepository,
    mode,
    triggerContext,
    explicitMode,
  }
}

export function buildPrDataContext(
  pr: PullRequestType,
  thread: PullRequestThreadType[],
  changes: PullRequestChangesType
): string {
  const commits = pr.commits || []
  let totalAdditions = 0
  let totalDeletions = 0

  for (const change of changes) {
    if (change.item && change.changeType === "add") {
      totalAdditions++
    }

    if (change.item && change.changeType === "delete") {
      totalDeletions++
    }
  }

  const threadGroups =
    thread
      ?.map((t) => {
        const threadComments =
          t.comments
            ?.filter((c) => !c.isDeleted && c.commentType != "system")
            .map((c) => {
              const author = c.author.uniqueName || c.author.displayName || "Unknown"
              return `  - ${author} at ${c.publishedDate}: ${c.content}`
            }) ?? []

        const location = t.threadContext?.filePath
          ? `${t.threadContext.filePath}${t.threadContext.rightFileStart ? `:${t.threadContext.rightFileStart.line}` : ""}`
          : "General"

        if (threadComments.length === 0) return null

        return `Thread on ${location}:\n${threadComments.join("\n")}`
      })
      .filter(Boolean) ?? []

  const files = changes.map((f) => {
    const changeType = f.changeType === "edit" ? "changed" : f.changeType
    return `- ${f.item.path} (${changeType})`
  })

  const reviews = pr.reviewers
    .filter((r) => r.vote !== 0)
    .map((r) => `- ${r.displayName}: vote=${r.vote} (${getVoteDescription(r.vote)})`)

  const sections: string[] = [
    "<pull_request>",
    `Title: ${pr.title}`,
    `Body: ${pr.description}`,
    `Author: ${pr.createdBy.uniqueName || pr.createdBy.displayName}`,
    `Created At: ${pr.creationDate}`,
    `Base Branch: ${pr.targetRefName}`,
    `Head Branch: ${pr.sourceRefName}`,
    `State: ${pr.status}`,
    `Additions: ${totalAdditions}`,
    `Deletions: ${totalDeletions}`,
    `Total Commits: ${commits.length}`,
    `Changed Files: ${changes.length} files`,
    `<pull_request_changed_files>\n${files.join("\n")}\n</pull_request_changed_files>`,
    `<pull_request_reviews>\n${reviews.join("\n")}\n</pull_request_reviews>`,
    `<pull_request_threads>\n${threadGroups.join("\n\n")}\n</pull_request_threads>`,
    `</pull_request>`,
  ]
  return sections.join("\n")
}

function getVoteDescription(vote: number): string {
  switch (vote) {
    case 10:
      return "approved"
    case 5:
      return "approved with suggestions"
    case 0:
      return "no vote"
    case -5:
      return "waiting for author"
    case -10:
      return "rejected"
    default:
      return "unknown"
  }
}

export async function cleanupWorkspace(workspace: string): Promise<void> {
  console.log(`Cleaning up workspace: ${workspace}`)
  try {
    await fs.rm(workspace, { recursive: true, force: true })
    console.log("Workspace cleaned up successfully")
  } catch (err) {
    console.warn(`Failed to clean up workspace (may be locked): ${(err as Error).message}`)
  }
}
