import { run } from "./runner.js"

await run({
  repository: {
    organization: "trojanmartin",
    project: "dependabot-test",
    repositoryId: "34a46682-797f-493e-8e73-117740e16341",
  },
  opencodeConfig: {
    agent: "build",
    providerID: "github-copilot",
    modelID: "gpt-4.1",
  },
  context: {
    pullRequestId: 1,
    threadId: 5,
    commentId: 1,
  },
  pat: "<>>",
})

process.exit(0)
