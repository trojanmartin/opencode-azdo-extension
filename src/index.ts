import { createOpencodeClient } from "@opencode-ai/sdk"
import { spawn } from "node:child_process"
import { promisify } from "node:util"
import { exec as execCallback } from "node:child_process"
import { promises as fs } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

import { getPullRequest, listPullRequests } from "./azure-devops-api.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const exec = promisify(execCallback)

interface Repo {
  id: string
  name: string
  project: string
  organization: string
}

interface ReviewPrOptions {
  repo: Repo
  sourceBranch: string
  targetBranch: string
  prId: number
}

interface ClonePrRepoOptions {
  options: ReviewPrOptions
  pat: string
  workspacePath?: string
}

interface CommitOptions {
  repoPath: string
  message: string
  files?: { path: string; content: string }[]
}

function createOpencode() {
  const host = "127.0.0.1"
  const port = 4096
  const url = `http://${host}:${port}`
  const proc = spawn("opencode", ["serve", `--hostname=${host}`, `--port=${port}`])
  const client = createOpencodeClient({ baseUrl: url })

  return {
    server: {
      url,
      close: () => {
        proc.stdin.destroy()
        proc.kill()
      },
    },
    client,
  }
}

const { client: client, server: server } = createOpencode()
let session: { id: string; title: string; version: string }

export async function reviewPr(): Promise<void> {
  try {
    await assertOpencodeConnected()
    console.log("Connected to opencode server")
    session = await client.session.create<true>().then((r) => r.data)
    console.log(`Created session: ${JSON.stringify(session)}`)
    subscribeSessionEvents()

    const response = await chat("Review code in current directory and suggest improvements.")
    console.log("Response from opencode:", response)
  } catch (err) {
    console.log((err as Error).message)
  } finally {
    console.log("Closing opencode server...")
    server.close()
  }
}

export async function clonePrRepo(config: ClonePrRepoOptions): Promise<string> {
  const { options, pat, workspacePath = "./workspace" } = config

  const workspaceDir = `${workspacePath}/${options.repo.name}`

  console.log(`Cloning repository ${options.repo.name}...`)

  try {
    await exec(
      `git clone --single-branch --branch ${options.sourceBranch} https://:${pat}@dev.azure.com/${options.repo.organization}/${options.repo.project}/_git/${options.repo.name} "${workspaceDir}"`
    )

    console.log(`Successfully cloned repository to: ${workspaceDir}`)
    console.log(`Checked out branch: ${options.sourceBranch}`)

    return workspaceDir
  } catch (err) {
    throw new Error(`Failed to clone repository: ${(err as Error).message}`)
  }
}

export async function commitChanges(config: CommitOptions): Promise<void> {
  const { repoPath, message, files } = config

  console.log(`Committing changes to ${repoPath}...`)

  if (files) {
    for (const file of files) {
      const filePath = join(repoPath, file.path)
      const dirPath = dirname(filePath)

      await fs.mkdir(dirPath, { recursive: true })
      await fs.writeFile(filePath, file.content, "utf-8")
      console.log(`Created/updated: ${file.path}`)
    }
  }

  try {
    await exec(`cd "${repoPath}" && git add -A`)
    await exec(`cd "${repoPath}" && git commit -m "${message}"`)
    console.log("Changes committed successfully")
  } catch (err) {
    throw new Error(`Failed to commit changes: ${(err as Error).message}`)
  }
}

export async function pushChanges(repoPath: string): Promise<void> {
  console.log(`Pushing changes from ${repoPath}...`)

  try {
    await exec(`cd "${repoPath}" && git push`)
    console.log("Changes pushed successfully")
  } catch (err) {
    throw new Error(`Failed to push changes: ${(err as Error).message}`)
  }
}

export async function cleanWorkspace(workspacePath: string): Promise<void> {
  console.log(`Cleaning workspace: ${workspacePath}...`)

  try {
    await exec(`rm -rf "${workspacePath}"`)
    console.log("Workspace cleaned successfully")
  } catch (err) {
    throw new Error(`Failed to clean workspace: ${(err as Error).message}`)
  }
}

async function getPrRemoteUrl(repo: Repo, pat: string): Promise<string> {
  const remoteUrl = `https://:${pat}@dev.azure.com/${repo.organization}/${repo.project}/_git/${repo.name}`
  return remoteUrl
}

async function chat(text: string) {
  console.log("Sending message to opencode...")
  const { providerID, modelID } = {
    providerID: "github-copilot",
    modelID: "gpt-4.1",
  }
  const agent = "plan"

  const result = await client.session.prompt<true>({
    path: session,
    body: {
      model: { providerID, modelID },
      agent,
      parts: [
        {
          type: "text",
          text,
        },
      ],
    },
  })

  console.log(JSON.stringify(result))
}

async function assertOpencodeConnected() {
  let retry = 0
  let connected = false
  do {
    try {
      await client.app.log<true>({
        body: {
          service: "azdo-pipeline",
          level: "info",
          message: "Prepare to react to Azure DevOps Pipeline event",
        },
      })
      connected = true
      break
    } catch (e) {}
    await new Promise((resolve) => setTimeout(resolve, 300))
  } while (retry++ < 30)

  if (!connected) {
    throw new Error("Failed to connect to opencode server")
  }
}

async function subscribeSessionEvents() {
  console.log("Subscribing to session events...")

  const TOOL: Record<string, [string, string]> = {
    todowrite: ["Todo", "\x1b[33m\x1b[1m"],
    todoread: ["Todo", "\x1b[33m\x1b[1m"],
    bash: ["Bash", "\x1b[31m\x1b[1m"],
    edit: ["Edit", "\x1b[32m\x1b[1m"],
    glob: ["Glob", "\x1b[34m\x1b[1m"],
    grep: ["Grep", "\x1b[34m\x1b[1m"],
    list: ["List", "\x1b[34m\x1b[1m"],
    read: ["Read", "\x1b[35m\x1b[1m"],
    write: ["Write", "\x1b[32m\x1b[1m"],
    websearch: ["Search", "\x1b[2m\x1b[1m"],
  }

  const response = await fetch(`${server.url}/event`)
  if (!response.body) throw new Error("No response body")

  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  let text = ""
  ;(async () => {
    while (true) {
      try {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split("\n")
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue

          const jsonStr = line.slice(6).trim()
          if (!jsonStr) continue

          try {
            const evt = JSON.parse(jsonStr)

            if (evt.type === "message.part.updated") {
              if (evt.properties.part.sessionID !== session.id) continue
              const part = evt.properties.part

              if (part.type === "tool" && part.state.status === "completed") {
                const [tool, color] = TOOL[part.tool] ?? [part.tool, "\x1b[34m\x1b[1m"]
                const title =
                  part.state.title ||
                  (Object.keys(part.state.input).length > 0
                    ? JSON.stringify(part.state.input)
                    : "Unknown")
                console.log()
                console.log(
                  color + "|",
                  "\x1b[0m\x1b[2m" + ` ${tool.padEnd(7, " ")}`,
                  "",
                  "\x1b[0m" + title
                )
              }

              if (part.type === "text") {
                text = part.text

                if (part.time?.end) {
                  console.log()
                  console.log(text)
                  console.log()
                  text = ""
                }
              }
            }

            if (evt.type === "session.updated") {
              if (evt.properties.info.id !== session.id) continue
              session = evt.properties.info
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      } catch (e) {
        console.log("Subscribing to session events done", e)
        break
      }
    }
  })()
}
