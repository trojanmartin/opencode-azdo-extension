import {
  addPullRequestComment,
  editPullRequestComment,
  getPullRequest,
  getPullRequestIterationChanges,
  getPullRequestIterations,
} from "./azure-devops-api.js"
import {
  cleanupWorkspace,
  delay,
  getCommentFooter,
  resolveOrganization,
  validateTrigger,
  buildDataContext,
} from "./common.js"

import {
  assertOpencodeInstalled,
  createOpencodeInstance,
  sendPrompt,
  subscribeToSessionEvents,
  waitForConnection,
} from "./opencode.js"
import {
  cloneRepo,
  commitChanges,
  hasUncommittedChanges,
  pushChanges,
  setupGitConfig,
} from "./git.js"

import type { ResolvedRunConfig } from "./common.js"

export async function runCommand(config: ResolvedRunConfig): Promise<void> {
  const {
    repository,
    context,
    pat,
    workspacePath = "./workspace",
    buildId,
    triggerContext,
    opencodeConfig,
  } = config
  const organization = resolveOrganization(config)
  const { project, repositoryId } = repository

  if (!organization) {
    throw new Error("Unable to determine organization for command run.")
  }
  const { pullRequestId, threadId, commentId } = context
  const { thread, comment } = triggerContext

  let opencode: ReturnType<typeof createOpencodeInstance> | null = null
  let workspace: string | null = null

  try {
    await assertOpencodeInstalled()
    console.log("Starting command mode run...")
    console.log(`PR #${pullRequestId}, Thread #${threadId}, Comment #${commentId}`)

    validateTrigger(comment.content, "command")

    const footer = getCommentFooter(organization, project, buildId)
    const replyComment = await addPullRequestComment(
      organization,
      project,
      repositoryId,
      pullRequestId,
      threadId,
      pat,
      `Working on it...${footer}`,
      commentId
    )
    console.log("Added 'working on it' reply")

    const [pr, iterationsData] = await Promise.all([
      getPullRequest(organization, project, pullRequestId, pat, { includeCommits: true }),
      getPullRequestIterations(organization, project, repositoryId, pullRequestId, pat),
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

    const sourceBranch = pr.sourceRefName.replace("refs/heads/", "")
    workspace = await cloneRepo({
      organization,
      project,
      repositoryId,
      branch: sourceBranch,
      pat,
      workspacePath,
    })
    console.log(`Repository cloned to: ${workspace}`)

    await setupGitConfig(workspace)

    const dataContext = buildDataContext(pr, thread, changesData.changeEntries)
    const promptString = `${comment.content}\n\n ${dataContext}`

    console.log("\n--- Prompt ---")
    console.log(promptString)
    console.log("--- End Prompt ---\n")

    opencode = createOpencodeInstance(workspace)

    await waitForConnection(opencode.client)
    console.log("Connected to opencode server")

    const sessionResp = await opencode.client.session.create<true>()
    const session = sessionResp.data

    subscribeToSessionEvents(opencode.server, session)

    const response = await sendPrompt(opencode.client, session, promptString, opencodeConfig)

    if (await hasUncommittedChanges(workspace)) {
      console.log("\nChanges detected, committing and pushing...")

      const summary = await sendPrompt(
        opencode.client,
        session,
        `Summarize the following in less than 40 characters:\n\n${response}`,
        opencodeConfig
      )

      await commitChanges(workspace, summary)
      await pushChanges(workspace)
    } else {
      console.log("\nNo changes detected in repository")
    }

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
    console.error("Error during command mode run:", (err as Error).message)
    throw err
  } finally {
    if (opencode) {
      console.log("Closing opencode server...")
      opencode.server.process.kill()
      await delay(1000)
    }
    if (workspace) {
      await cleanupWorkspace(workspace)
    }
  }
}
