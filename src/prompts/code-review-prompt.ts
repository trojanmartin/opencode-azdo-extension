export interface ReviewPromptContext {
  changedFiles: Array<{
    path: string
    changeType: string
  }>
  prTitle: string
  prDescription: string
  toolPath: string
  contextData?: string
}

export function buildCodeReviewPrompt(context: ReviewPromptContext): string {
  const filesList = context.changedFiles
    .map((file) => `- ${file.path} (${file.changeType})`)
    .join("\n")

  const extraContext = context.contextData
    ? `\n## Additional Context\n${context.contextData}\n`
    : ""

  return `You are performing a code review on a pull request.

## Pull Request Context
**Title:** ${context.prTitle}
**Description:** ${context.prDescription || "No description provided"}
${extraContext}
## Changed Files to Review
${filesList}

## Your Task
Review the changed files listed above for:
- Code quality issues
- Potential bugs
- Security vulnerabilities
- Performance concerns
- Best practice violations
- Error handling gaps
- Missing edge cases

You have access to the entire repository for context, but focus your review comments on the changed files only.

## How to Add Review Comments

To add a comment to a specific file and line, run the following bash command:

\`\`\`bash
${context.toolPath} --file "<file_path>" --line <line_number> --comment "<your comment>"
\`\`\`

**Parameters:**
- \`--file\` or \`-f\`: The path to the file (e.g., "src/utils/helper.ts")
- \`--line\` or \`-l\`: The line number to comment on (must be a positive integer)
- \`--comment\` or \`-c\`: Your review comment text

**Example:**
\`\`\`bash
${context.toolPath} --file "src/services/api.ts" --line 42 --comment "Consider using optional chaining here to handle potential null values."
\`\`\`

## Guidelines
- Be constructive and specific in your feedback
- Explain WHY something is an issue, not just what
- Suggest concrete improvements when possible
- Focus on significant issues, not nitpicks
- Consider the context and intent of the code

## Summary
After reviewing all changed files and adding comments, provide a summary of your findings including:
- Total number of issues found
- Issues categorized by type (bugs, security, performance, code quality, etc.)
- Key areas of concern
- Overall assessment of the changes (e.g., "Ready to merge", "Needs minor fixes", "Requires significant changes")
`
}
