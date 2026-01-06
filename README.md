# OpenCode Azure DevOps Extension

Azure DevOps pipeline task for running [OpenCode](https://opencode.ai) AI agents in your pipeline.

Run AI powered code reviews on pull requests automatically or mention /opencode in your comment, and opencode will execute tasks within your Azure DevOps pipeline.

## What it does

- Run AI powered code reviews on pull requests automatically.
- Mention `/opencode` or `/oc` in your PR comment, and opencode will execute tasks within your Azure DevOps pipeline.

## Install the extension

- From Marketplace: install into your organization and add the task `OpenCodeAgent@1` to a pipeline.

## Code review as PR build validation pipeline

Run automated AI driven code review on every PR update.
Create a pipeline with the following YAML and set it as a PR build validation policy:

```yaml
trigger: none
pool:
  vmImage: ubuntu-latest

steps:
  - script: |
      curl -fsSL https://bun.sh/install | bash
      echo "##vso[task.prependpath]$HOME/.bun/bin"
    displayName: Install Bun

  - script: |
      curl -fsSL https://opencode.ai/install | bash
      echo "##vso[task.prependpath]$HOME/.opencode/bin"
    displayName: Install OpenCode

  - task: OpenCodeAgent@1
    displayName: OpenCode PR Agent
    inputs:
      mode: review
      pat: "your-personal-access-token" # or use $(System.AccessToken)
      providerID: opencode
      modelID: glm-4.7-free
```

Notes:

- Use a PAT with `Code (read and write)` and `Pull Requests (read and write)` scopes. You can also use `$(System.AccessToken)` if the build service identity has the required scopes.

## Provide custom review instructions

Use the `reviewPrompt` input to customize the review instructions. For example, to focus on security issues:

```yaml
steps:
  - task: OpenCodeAgent@1
    displayName: "OpenCode Security Review"
    inputs:
      mode: "review"
      pat: "$(System.AccessToken)"
      providerID: "anthropic"
      modelID: "claude-sonnet-4"
      reviewPrompt: |
        Review this pull request for security vulnerabilities, focusing on:
        - SQL injection and XSS attacks
        - Hardcoded secrets or API keys
        - Insecure authentication patterns
        - Missing input validation

        Be strict and flag all potential issues.
```

The script execution instructions and PR context are always included automatically—you only need to specify what to review.

## Comment-triggered command mode (webhook + custom app)

Want to run opencode on demand via PR comments the same way as on Github actions? To automate:

1. Create a pipeline that uses the following YAML (similar to above but with parameters for IDs):
2. Create an Azure DevOps service hook for PR comments and point it to **your** custom application.
3. Your application must parse the webhook payload and invoke the pipeline above, passing all required parameters.

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
  - script: |
      curl -fsSL https://bun.sh/install | bash
      echo "##vso[task.prependpath]$HOME/.bun/bin"
    displayName: Install Bun

  - script: |
      curl -fsSL https://opencode.ai/install | bash
      echo "##vso[task.prependpath]$HOME/.opencode/bin"
    displayName: Install OpenCode

  - task: OpenCodeAgent@1
    displayName: "OpenCode AI agent"
    inputs:
      threadId: "${{ parameters.threadId }}"
      commentId: "${{ parameters.commentId }}"
      pullRequestId: "${{ parameters.pullRequestId }}"
      repositoryId: "${{ parameters.repositoryId }}"
      organization: "${{ parameters.organization }}"
      project: "${{ parameters.project }}"
      pat: "your-personal-access-token" # or use $(System.AccessToken)
      providerID: "github-copilot"
      modelID: "gpt-4.1"
      agent: "build"
```

## Support

- Issues and questions: open an issue in this repository.
- Hosted trigger app: coming soon as an optional paid service.
