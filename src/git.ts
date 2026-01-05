import { promisify } from "node:util"
import { exec as execCallback } from "node:child_process"

const exec = promisify(execCallback)

export interface CloneRepoOptions {
  organization: string
  project: string
  repositoryId: string
  branch: string
  pat: string
  workspacePath: string
}

export async function cloneRepo(options: CloneRepoOptions): Promise<string> {
  const { organization, project, repositoryId, branch, pat, workspacePath } = options
  const workspaceDir = `${workspacePath}/${repositoryId}`

  console.log(`Cloning repository ${repositoryId}...`)

  await exec(
    `git clone --single-branch --branch ${branch} https://:${pat}@dev.azure.com/${organization}/${project}/_git/${repositoryId} "${workspaceDir}"`
  )

  console.log(`Successfully cloned repository to: ${workspaceDir}`)
  console.log(`Checked out branch: ${branch}`)

  return workspaceDir
}

export async function setupGitConfig(repoPath: string): Promise<void> {
  await exec(`cd "${repoPath}" && git config user.email "opencode-bot@azure-devops.local"`)
  await exec(`cd "${repoPath}" && git config user.name "OpenCode Bot"`)
}

export async function commitChanges(repoPath: string, message: string): Promise<void> {
  console.log(`Committing changes to ${repoPath}...`)

  await exec(`cd "${repoPath}" && git add -A`)
  await exec(`cd "${repoPath}" && git commit -m "${message}"`)
  console.log("Changes committed successfully")
}

export async function pushChanges(repoPath: string): Promise<void> {
  console.log(`Pushing changes from ${repoPath}...`)
  await exec(`cd "${repoPath}" && git push`)
  console.log("Changes pushed successfully")
}

export async function hasUncommittedChanges(repoPath: string): Promise<boolean> {
  const { stdout } = await exec(`cd "${repoPath}" && git status --porcelain`)
  return stdout.trim().length > 0
}
