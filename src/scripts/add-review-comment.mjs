#!/usr/bin/env node

/**
 * Cross-platform review comment helper for Azure DevOps pull requests.
 *
 * Usage:
 *   node add-review-comment.mjs --file <path> --line <number> --comment "<text>"
 */

import { exit, argv } from "node:process"
import { posix as pathPosix } from "node:path"

const REQUIRED_ENV_VARS = [
  "AZURE_DEVOPS_ORG",
  "AZURE_DEVOPS_PROJECT",
  "AZURE_DEVOPS_REPO_ID",
  "AZURE_DEVOPS_PR_ID",
  "AZURE_DEVOPS_PAT",
]

function printUsage() {
  console.error("Usage: node add-review-comment.mjs --file <path> --line <number> --comment <text>")
}

function parseArgs(args) {
  const options = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (["--file", "-f"].includes(arg)) {
      options.file = args[++i]
    } else if (["--line", "-l"].includes(arg)) {
      options.line = args[++i]
    } else if (["--comment", "-c"].includes(arg)) {
      options.comment = args[++i]
    } else {
      console.error(`Unknown option: ${arg}`)
      printUsage()
      exit(1)
    }
  }
  return options
}

function ensureLeadingSlash(filePath) {
  if (!filePath) return filePath
  const normalized = pathPosix.normalize(filePath.replace(/\\/g, "/"))
  return normalized.startsWith("/") ? normalized : `/${normalized}`
}

function validateOptions(options) {
  if (!options.file || !options.line || !options.comment) {
    printUsage()
    exit(1)
  }

  const lineNumber = Number(options.line)
  if (!Number.isInteger(lineNumber) || lineNumber <= 0) {
    console.error("--line must be a positive integer")
    exit(1)
  }

  return { ...options, line: lineNumber }
}

function validateEnvVars() {
  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      console.error(`Missing required environment variable: ${key}`)
      exit(1)
    }
  }
}

function getEnvVars() {
  validateEnvVars()
  return {
    org: process.env.AZURE_DEVOPS_ORG,
    project: process.env.AZURE_DEVOPS_PROJECT,
    repoId: process.env.AZURE_DEVOPS_REPO_ID,
    prId: process.env.AZURE_DEVOPS_PR_ID,
    pat: process.env.AZURE_DEVOPS_PAT,
  }
}

async function createReviewComment({ file, line, comment }) {
  const { org, project, repoId, prId, pat } = getEnvVars()
  const apiUrl = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repoId}/pullRequests/${prId}/threads?api-version=7.1`

  const requestBody = {
    comments: [
      {
        content: comment,
        commentType: 1,
      },
    ],
    status: 1,
    threadContext: {
      filePath: ensureLeadingSlash(file),
      rightFileStart: {
        line,
        offset: 1,
      },
      rightFileEnd: {
        line,
        offset: 1,
      },
    },
  }

  const authHeader = Buffer.from(`:${pat}`).toString("base64")

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${authHeader}`,
      },
      body: JSON.stringify(requestBody),
    })

    if (response.ok) {
      console.log(`Comment added to ${ensureLeadingSlash(file)}:${line}`)
      exit(0)
    }

    const body = await response.text()
    console.error(
      `Warning: Failed to add comment (HTTP ${response.status}): ${body || "<empty response>"}`
    )
    exit(0)
  } catch (error) {
    console.error(`Warning: Request failed - ${error?.message || error}`)
    exit(0)
  }
}

async function main() {
  const options = validateOptions(parseArgs(argv.slice(2)))
  await createReviewComment(options)
}

await main()
