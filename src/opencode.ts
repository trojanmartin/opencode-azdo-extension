import { spawn, ChildProcess } from "node:child_process"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { delay, type OpencodeConfig } from "./common"

const OPENCODE_HOST = "127.0.0.1"
const OPENCODE_PORT = 4096
const CONNECTION_RETRY_DELAY_MS = 300
const CONNECTION_MAX_RETRIES = 30

const TOOL_DISPLAY: Record<string, [string, string]> = {
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

export type OpencodeClient = ReturnType<typeof createOpencodeClient>

export interface OpencodeServer {
  url: string
  process: ChildProcess
}

export interface OpencodeSession {
  id: string
  title: string
  version: string
}

export interface OpencodeInstance {
  client: OpencodeClient
  server: OpencodeServer
}

export async function assertOpencodeInstalled(): Promise<void> {
  const { promisify } = await import("node:util")
  const { exec: execCallback } = await import("node:child_process")
  const exec = promisify(execCallback)

  try {
    await exec("opencode --version")
  } catch {
    throw new Error(
      "OpenCode CLI is not installed on this agent. Please install it following the instructions at: https://opencode.ai/"
    )
  }
}

export function createOpencodeInstance(workspaceDir: string): OpencodeInstance {
  const url = `http://${OPENCODE_HOST}:${OPENCODE_PORT}`

  const proc = spawn(
    "opencode",
    ["serve", `--hostname=${OPENCODE_HOST}`, `--port=${OPENCODE_PORT}`],
    {
      cwd: workspaceDir,
    }
  )

  return {
    server: { url, process: proc },
    client: createOpencodeClient({ baseUrl: url }),
  }
}

export async function waitForConnection(client: OpencodeClient): Promise<void> {
  for (let attempt = 0; attempt < CONNECTION_MAX_RETRIES; attempt++) {
    try {
      await client.app.log<true>({
        body: {
          service: "azdo-runner",
          level: "info",
          message: "Connecting to OpenCode server",
        },
      })
      return
    } catch {
      await delay(CONNECTION_RETRY_DELAY_MS)
    }
  }

  throw new Error("Failed to connect to opencode server")
}

export async function sendPrompt(
  client: OpencodeClient,
  session: OpencodeSession,
  text: string,
  config: OpencodeConfig
): Promise<string> {
  console.log("Sending message to opencode...")

  const agent = await resolveAgent(client, config.agent)
  const result = await client.session.prompt<true>({
    path: session,
    body: {
      model: { providerID: config.providerID, modelID: config.modelID },
      agent: agent,
      parts: [{ type: "text", text }],
    },
  })

  if (result.response.status !== 200) {
    throw new Error(`OpenCode prompt failed with status ${result.response.status}`)
  }

  const textParts = result.data.parts.filter((p) => p.type === "text")
  return textParts[textParts.length - 1]?.text || ""
}

export function subscribeToSessionEvents(server: OpencodeServer, session: OpencodeSession): void {
  console.log("Subscribing to session events...")

  const processEvent = (evt: { type: string; properties: Record<string, unknown> }): void => {
    if (evt.type === "message.part.updated") {
      const part = evt.properties.part as Record<string, unknown>
      if ((part.sessionID as string) !== session.id) return

      if (part.type === "tool") {
        const state = part.state as Record<string, unknown>
        if (state.status === "completed") {
          const toolName = part.tool as string
          const [displayName, color] = TOOL_DISPLAY[toolName] ?? [toolName, "\x1b[34m\x1b[1m"]
          const input = state.input as Record<string, unknown>
          const title =
            (state.title as string) ||
            (Object.keys(input).length > 0 ? JSON.stringify(input) : "Unknown")

          console.log()
          console.log(
            color + "|",
            "\x1b[0m\x1b[2m" + ` ${displayName.padEnd(7, " ")}`,
            "",
            "\x1b[0m" + title
          )
        }
      }

      if (part.type === "text") {
        const time = part.time as { end?: boolean } | undefined
        if (time?.end) {
          console.log()
          console.log(part.text as string)
          console.log()
        }
      }
    }
  }

  ;(async (): Promise<void> => {
    try {
      const response = await fetch(`${server.url}/event`)
      if (!response.body) return

      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })

        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue

          const jsonStr = line.slice(6).trim()
          if (!jsonStr) continue

          try {
            processEvent(JSON.parse(jsonStr))
          } catch {
            // SSE parse errors are non-fatal
          }
        }
      }
    } catch {
      console.log("Session event subscription ended")
    }
  })()
}
async function resolveAgent(
  client: OpencodeClient,
  agent: string | undefined
): Promise<string | undefined> {
  if (!agent) {
    return undefined
  }

  const agents = await client.app.agents<true>()
  const resolved = agents.data?.find((a) => a.name === agent)
  if (!resolved) {
    console.warn(`agent "${agent}" not found. Falling back to default agent`)
    return undefined
  }

  if (resolved.mode === "subagent") {
    console.warn(
      `agent "${agent}" is a subagent, not a primary agent. Falling back to default agent`
    )
    return undefined
  }

  return resolved.name
}
