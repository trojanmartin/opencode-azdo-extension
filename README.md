# OpenCode Azure DevOps Extension

Azure DevOps pipeline task for running [OpenCode AI](https://opencode.ai) code reviews and automation in your CI/CD pipelines.

## Features

- **Automated Code Review** - Run AI code reviews automatically on every PR update via build validation
- **Use any Agent** - Define custom [OpenCode agents](https://opencode.ai/docs/agents) for specialized reviews or tasks
- **Flexible Models** - Use OpenAI, Anthropic, GitHub Copilot, or any OpenCode-supported provider

## Coming Soon

- **Comment-Triggered Commands** - Execute AI code review or any command on-demand via PR comments

## Quick Start: PR Code Reviews

The recommended setup is to use **review mode** as a PR build validation policy. This automatically reviews every pull request.

### 1. Create a Review Pipeline

```yaml
# Triggered automatically by PR build validation policy
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

- task: OpenCodeAgent@0
  displayName: Security Review
  inputs:
    mode: review
    agent: code-review # use any available agent
    pat: $(System.AccessToken)
    model: opencode/claude-opus-4-5
    reviewPrompt: | # optional, if not provided, default prompt is used
      Focus on security vulnerabilities:
      - SQL injection and XSS attacks
      - Hardcoded secrets or API keys
      - Insecure authentication/authorization
      - Missing input validation
      - Unsafe deserialization
  env:
    OPENCODE_API_KEY: $(AnthropicApiKey)
    OPENCODE_PERMISSION: '{"bash": "deny"}'
```

### 2. Configure Build Validation Policy

1. Go to **Project Settings** → **Repositories** → Select your repo → **Policies**
2. Under **Branch Policies** for your main branch, add **Build validation**
3. Select the pipeline you created above
4. Set **Trigger** to "Automatic"
5. Set **Policy requirement** to "Optional" (recommended for initial testing)

## Authentication

The task requires a PAT with these scopes:

| Scope                    | Permission   | Why                                                                               |
| ------------------------ | ------------ | --------------------------------------------------------------------------------- |
| **Code**                 | Read & Write | Read PR code; commit fixes in command mode (read-only sufficient for review mode) |
| **Pull Request Threads** | Read & Write | Post review comments and threads                                                  |

**Recommended:** Use `$(System.AccessToken)` and grant the build service identity the required permissions:

1. Go to **Project Settings** → **Repositories** → Your Repo → **Security**
2. Find **`{Project} Build Service ({Organization})`**
3. Grant:
   - **Contribute**: Allow (for reading code)
   - **Contribute to pull requests**: Allow (for posting comments)

## Task Inputs Reference

| Input           | Required | Default     | Description                                                                                |
| --------------- | -------- | ----------- | ------------------------------------------------------------------------------------------ |
| `mode`          | No       | Auto-detect | `review` = code review, `command` = execute user command, empty = auto-detect from comment |
| `pat`           | Yes      | -           | Azure DevOps PAT or `$(System.AccessToken)`                                                |
| `model`         | Yes      | -           | Model to use: `opencode/glm-4.7-free`, `anthropic/claude-opus-4-5` etc.                    |
| `agent`         | No       | -           | OpenCode agent to use                                                                      |
| `reviewPrompt`  | No       | -           | Custom review instructions (review mode only)                                              |
| `commentUrl`    | No       | -           | PR comment URL (command mode only)                                                         |
| `organization`  | No       | Auto-detect | Azure DevOps organization name                                                             |
| `project`       | No       | Auto-detect | Azure DevOps project name                                                                  |
| `skipClone`     | No       | `false`     | Skip git clone (use existing workspace)                                                    |
| `workspacePath` | No       | Auto        | Custom workspace path                                                                      |

## Support & Contributing

- **Issues:** [GitHub Issues](https://github.com/trojanmartin/opencode-azdo-extension/issues)
- **Documentation:** [OpenCode Docs](https://opencode.ai/docs)
- **Source:** [GitHub Repository](https://github.com/trojanmartin/opencode-azdo-extension)

## License

MIT
