# OpenCode Azure DevOps Extension

Azure DevOps pipeline task for running OpenCode AI agents on pull requests—either automatically as PR build validation (review mode) or via comment-triggered runs (command mode).

## What it does

- Reads PR context (description, files, threads) and runs an AI agent.
- In review mode, posts a closed summary thread with findings (headless, no trigger comment needed).
- In command mode, responds to `/oc` or `/opencode` comments and can commit changes.

## Prerequisites

- Azure DevOps project/repository and a pipeline agent with Node.js 18+.
- OpenCode task installed from the VS Marketplace or your own packaged VSIX.
- OpenCode AI provider credentials (GitHub Copilot, Anthropic, OpenAI).
- PAT with scopes:
  - Code: Read (Write required only if command mode will commit).
  - Pull Request Threads: Read & Write.
- You may use `$(System.AccessToken)` if your build service has these scopes; otherwise supply a secret PAT variable.

## Install the extension

- From Marketplace: install into your organization and add the task `OpenCodeReview@1` to a pipeline.
- From source: `npm install && npm run build && npm run package`, then upload the `.vsix` to your organization.

## Recommended: PR build validation (review mode)

Run on every PR update.

```yaml
pool:
  vmImage: "ubuntu-latest"

steps:
  - task: OpenCodeReview@1
    displayName: "OpenCode PR Review"
    inputs:
      mode: "review"
      pat: "$(System.AccessToken)" # or a secret PAT
      providerID: "anthropic" # github-copilot | anthropic | openai
      modelID: "claude-sonnet-4"
      agent: "build" # default agent
```

Notes:

- Enable pipeline access to the token (e.g., “Allow scripts to access OAuth token”) or pass a secret PAT variable with required scopes.

## Comment-triggered command mode (webhook + custom app)

Command mode requires `threadId` and `commentId`. To automate:

1. Create a pipeline that accepts the parameters below and runs command mode.

```yaml
parameters:
  - name: threadId
    type: string
  - name: commentId
    type: string
  - name: pullRequestId
    type: string
  - name: repositoryId
    type: string
  - name: organization
    type: string
  - name: project
    type: string

pool:
  vmImage: "ubuntu-latest"

steps:
  - task: OpenCodeReview@1
    displayName: "OpenCode Command Mode"
    inputs:
      threadId: "${{ parameters.threadId }}"
      commentId: "${{ parameters.commentId }}"
      pullRequestId: "${{ parameters.pullRequestId }}"
      repositoryId: "${{ parameters.repositoryId }}"
      organization: "${{ parameters.organization }}"
      project: "${{ parameters.project }}"
      pat: "$(OpenCode.PAT)" # secret variable
      providerID: "github-copilot"
      modelID: "gpt-4.1"
      agent: "build"
```

2. Create an Azure DevOps service hook for PR comments and point it to **your** custom application.
3. Your application must parse the webhook payload and invoke the pipeline above, passing all required parameters (including `threadId`/`commentId`).
4. This application is owned/managed by you; keep PATs and secrets safe. We are working on providing a hosted trigger app as a managed service for a small monthly fee.

## Inputs reference

- `mode`: `review` (headless review) or `command` (comment-triggered). If omitted, `threadId` and `commentId` must be provided and mode is inferred from the comment trigger.
- `threadId`, `commentId`: Required for command mode; not needed for review mode.
- `pullRequestId`, `repositoryId`, `organization`, `project`: Auto-detected in pipelines; override via inputs if needed.
- `pat`: Token with required scopes (see prerequisites).
- `providerID`, `modelID`: AI provider and model.
- `agent`: OpenCode agent type (default `build`).
- `workspacePath`: Optional custom workspace directory.
- `skipClone`: Optional; when true, `workspacePath` must point to an existing checkout.

## Security

- Do not log PATs or secrets. Use pipeline secret variables or `$(System.AccessToken)` when permitted.
- Ensure the build service identity has the scopes listed above if relying on `System.AccessToken`.

## Support

- Issues and questions: open an issue in this repository.
- Hosted trigger app: coming soon as an optional paid service.
