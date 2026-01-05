# OpenCode Azure DevOps Extension

An Azure DevOps pipeline task that integrates [OpenCode AI](https://opencode.ai) to automatically respond to pull request comments and perform code changes using AI agents.

## 🎯 Purpose

This extension allows you to trigger OpenCode AI agents directly from pull request comments in Azure DevOps. When a team member comments on a PR with `/oc` or `/opencode` followed by a request, the extension:

1. Detects the trigger comment
2. Analyzes the pull request context (description, files changed, existing comments)
3. Executes the OpenCode AI agent with the request
4. Commits and pushes any code changes back to the PR
5. Replies to the comment with the agent's response

This enables AI-assisted code reviews, automated refactoring, bug fixes, and other code modifications directly from your PR workflow.

## ✨ Features

- **Comment-triggered execution** - Simply comment `/oc [your request]` on any PR
- **Full PR context** - AI agent has access to PR details, changed files, reviews, and comments
- **Automatic commits** - Changes are automatically committed and pushed to the source branch
- **Flexible configuration** - Choose your AI provider (GitHub Copilot, Anthropic, OpenAI) and model
- **Multiple agent types** - Support for different OpenCode agents (build, review, etc.)
- **Azure DevOps integration** - Works seamlessly with Azure Pipelines and pull requests

## 📋 Prerequisites

- Azure DevOps organization with a project and repository
- [OpenCode CLI](https://opencode.ai) installed on the build agent
- Personal Access Token (PAT) with permissions:
  - Code (Read & Write)
  - Pull Request Threads (Read & Write)
- AI provider credentials configured for OpenCode

## 🚀 Installation

### 1. Build the Extension

```bash
# Clone the repository
git clone https://github.com/trojanmartin/opencode-azdo-extension.git
cd opencode-azdo-extension

# Install dependencies
npm install

# Build the task
npm run build

# Package the extension
npm run package
```

### 2. Publish to Azure DevOps

```bash
# Install tfx-cli if not already installed
npm install -g tfx-cli

# Publish the extension (requires publisher account)
npm run publish
```

Or upload the generated `.vsix` file manually through the [Visual Studio Marketplace](https://marketplace.visualstudio.com/manage).

### 3. Install in Your Organization

1. Go to your Azure DevOps organization
2. Navigate to **Organization Settings** → **Extensions**
3. Click **Shared** or **Browse Marketplace**
4. Find and install the OpenCode extension

## 📖 Usage

### Basic Pipeline Configuration

Add the OpenCode task to your Azure Pipeline that runs on PR triggers:

```yaml
trigger: none

pr:
  branches:
    include:
      - main
      - develop

pool:
  vmImage: "ubuntu-latest"

steps:
  # Ensure OpenCode CLI is installed
  - script: |
      npm install -g @opencode-ai/cli
    displayName: "Install OpenCode CLI"

  # Run the OpenCode PR Agent task
  - task: OpenCodeReview@1
    inputs:
      threadId: "$(System.PullRequest.ThreadId)"
      commentId: "$(System.PullRequest.CommentId)"
      pat: "$(System.AccessToken)"
      providerID: "github-copilot"
      modelID: "gpt-4.1"
      agent: "build"
    displayName: "OpenCode PR Agent"
```

### Advanced Configuration

````yaml
steps:
  - task: OpenCodeReview@1
    inputs:
      # Required when mode is not set: Comment thread and comment identifiers
      threadId: "$(System.PullRequest.ThreadId)"
      commentId: "$(System.PullRequest.CommentId)"


      # Required: Authentication
      pat: "$(System.AccessToken)" # Or use a secret variable

      # Required: AI provider configuration
      providerID: "anthropic" # Options: github-copilot, anthropic, openai
      modelID: "claude-sonnet-4" # Model specific to provider

      # Optional: Agent type (default: build)
      agent: "build"

      # Optional: Custom workspace path
      workspacePath: "$(Pipeline.Workspace)/opencode"

      # Optional: Override auto-detected values
      organization: "myorg"
      project: "myproject"
      repositoryId: "$(Build.Repository.Id)"
      pullRequestId: "$(System.PullRequest.PullRequestId)"
    displayName: "OpenCode PR Agent"
```

## 💡 Example Use Cases

### 1. Request Code Improvements

**PR Comment:**

```
/oc Please add error handling to the new API endpoint and include unit tests
```

The AI agent will:

- Analyze the changed files
- Add appropriate error handling
- Create unit tests
- Commit the changes to the PR

### 2. Fix Linting Issues

**PR Comment:**

```
/opencode Fix all ESLint errors in the modified files
```

### 3. Refactor Code

**PR Comment:**

```
/oc Refactor the UserService class to follow the repository pattern
```

### 4. Add Documentation

**PR Comment:**

```
/oc Add JSDoc comments to all public methods in the modified files
```

### 5. Security Review

**PR Comment:**

```
/opencode Review the code for security vulnerabilities and fix any issues found
```

### 6. Headless Automated Review

Run a full code review on every PR update without requiring a trigger comment:

```yaml
steps:
  - task: OpenCodeReview@1
    inputs:
      mode: "review"
      pat: "$(System.AccessToken)"
      providerID: "anthropic"
      modelID: "claude-sonnet-4"
```

The agent analyzes all PR changes, considers existing threads and comments, and posts a closed summary thread when finished (or if an error occurs).

## ⚙️ Configuration Options


| Input       | Required    | Description                                                                   | Default       |
| ----------- | ----------- | ----------------------------------------------------------------------------- | ------------- |
| `threadId`  | Conditional | PR thread ID containing the trigger comment (required when `mode` is not set) | Auto-detected |
| `commentId` | Conditional | Comment ID that triggered the task (required when `mode` is not set)          | Auto-detected |
| `pat`       | Yes         | Azure DevOps Personal Access Token                                            | -             |

| `providerID` | Yes | OpenCode AI provider (github-copilot, anthropic, openai) | - |
| `modelID` | Yes | AI model identifier | - |
| `agent` | No | OpenCode agent type | `build` |
| `workspacePath` | No | Path for cloning the repository | Build.BinariesDirectory or Agent.TempDirectory |
| `organization` | No | Azure DevOps organization name | Auto-detected from System.CollectionUri |
| `project` | No | Azure DevOps project name | Auto-detected from System.TeamProject |
| `repositoryId` | No | Repository UUID | Auto-detected from Build.Repository.Id |
| `pullRequestId` | No | Pull request number | Auto-detected from System.PullRequest.PullRequestId |

## 🛠️ Development

### Build the Project

```
npm run build
```

### Local Debugging

```
cp debug-config.sample.json debug-config.json
# edit debug-config.json to match your PR/PAT
npm run debug -- debug-config.json
```

- `debug.ts` loads the JSON config, resolves the run mode, and executes the same `runCommand`/`runCodeReview` flows used in CI.
- If you omit the path argument, the runner looks for `debug-config.json` in the repo root.
- The debug entry talks to live Azure DevOps APIs—use a real PAT and review IDs.

### Run Linting

```bash
npm run lint
npm run lint:fix
```

### Format Code

```bash
npm run format
npm run format:check
```

### Clean Build Artifacts

```bash
npm run clean
```

## 📦 Publishing

### Create Development Package

```bash
npm run package:dev
```

This creates a private extension package for testing.

### Publish to Marketplace

```bash
# Update version in package.json, task.json, and vss-extension.json
# Then run:
npm run publish
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Links

- [OpenCode AI](https://opencode.ai)
- [Azure DevOps Extensions Documentation](https://learn.microsoft.com/en-us/azure/devops/extend/)
- [Azure Pipelines Task SDK](https://github.com/microsoft/azure-pipelines-task-lib)

## 💬 Support

For issues, questions, or contributions, please open an issue on the [GitHub repository](https://github.com/trojanmartin/opencode-azdo-extension).

---

**Note:** This extension requires the OpenCode CLI to be installed on your build agents. Make sure to include the installation step in your pipeline configuration.
````
