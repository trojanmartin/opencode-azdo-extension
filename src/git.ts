import { promisify } from "node:util"
import { exec as execCallback } from "node:child_process"
import { join } from "node:path"

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

export async function getFileDiffHunk(
  repoPath: string,
  targetBranch: string,
  filePath: string,
  lineNumber?: number
): Promise<string> {
  try {
    await exec(
      `cd "${repoPath}" && git fetch origin ${targetBranch}:refs/remotes/origin/${targetBranch}`
    )
    // Get the diff for the specific file against the target branch with function context
    const normalizedFilePath = filePath.startsWith("/") ? filePath.slice(1) : join(".", filePath)
    const { stdout } = await exec(
      `cd "${repoPath}" && git diff -p origin/${targetBranch}...HEAD -- "${normalizedFilePath}"`
    )

    if (!stdout.trim()) {
      return ""
    }

    // If no line number specified, return the entire file diff
    if (!lineNumber) {
      return stdout.trim()
    }

    // Parse hunks and find the one containing the target line
    const hunks = parseHunks(stdout)
    const relevantHunk = hunks.find((hunk) => {
      return lineNumber >= hunk.newStart && lineNumber < hunk.newStart + hunk.newLines
    })

    return relevantHunk ? relevantHunk.content : stdout.trim()
  } catch (err) {
    console.warn(`Failed to get diff hunk for ${filePath}:`, (err as Error).message)
    return ""
  }
}

interface ParsedHunk {
  newStart: number
  newLines: number
  content: string
}

function parseHunks(diff: string): ParsedHunk[] {
  const hunks: ParsedHunk[] = []
  const lines = diff.split("\n")
  let currentHunk: string[] = []
  let currentHunkInfo: { newStart: number; newLines: number } | null = null

  for (const line of lines) {
    // Match hunk header: @@ -old_start,old_lines +new_start,new_lines @@ optional context
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@(.*)$/)
    if (hunkMatch) {
      // Save previous hunk if exists
      if (currentHunkInfo && currentHunk.length > 0) {
        hunks.push({
          ...currentHunkInfo,
          content: currentHunk.join("\n"),
        })
      }
      // Start new hunk - preserve the entire line including context
      currentHunkInfo = {
        newStart: parseInt(hunkMatch[1] || "0", 10),
        newLines: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
      }
      currentHunk = [line]
    } else if (currentHunkInfo) {
      currentHunk.push(line)
    }
  }

  // Save last hunk
  if (currentHunkInfo && currentHunk.length > 0) {
    hunks.push({
      ...currentHunkInfo,
      content: currentHunk.join("\n"),
    })
  }

  return hunks
}
