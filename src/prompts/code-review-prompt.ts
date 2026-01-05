export interface ReviewPromptContext {
  toolPath: string
  contextData?: string
}

export function buildCodeReviewPrompt(context: ReviewPromptContext): string {
  return `You are performing a code review on a pull request.

You have access to the entire repository for context, but focus your review comments on the changed files only.

## How to Add Review Comments

Use the node script to create comments on the files for the violations. Try to leave the comment on the exact line number. If you have a suggested fix include it in a suggestion code block.
If you are writing suggested fixes, BE SURE THAT the change you are recommending is actually valid code, often I have seen missing closing "}" or other syntax errors.
Generally, write a comment instead of writing suggested change if you can help it.

Command MUST be like this.

\`\`\`bash
node ${context.toolPath} --file "<file_path>" --line <line_number> --comment "<your comment>"
\`\`\`

**Example:**
\`\`\`bash
node ${context.toolPath} --file "src/services/api.ts" --line 42 --comment "Consider using optional chaining here to handle potential null values."
\`\`\`

## Your Task
Review the changed files listed bellow for:
- Code quality issues
- Potential bugs
- Security vulnerabilities
- Performance concerns
- Best practice violations
- Error handling gaps
- Missing edge cases

## Guidelines
- Be constructive and specific in your feedback
- Explain WHY something is an issue, not just what
- Suggest concrete improvements when possible
- Focus on significant issues, not nitpicks
- Consider the context and intent of the code

## Pull request context
${context.contextData ?? "_No additional context provided._"}
`
}
