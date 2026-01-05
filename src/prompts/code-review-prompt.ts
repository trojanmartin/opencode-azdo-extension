export interface ReviewPromptContext {
  toolPath: string
  contextData: string
  customPrompt?: string
}

const DEFAULT_REVIEW_INSTRUCTIONS = `
You have access to the entire repository for context, but focus your review comments on the changed files only.

## Review Guidelines
- Look for bugs, performance issues, security vulnerabilities, and code smells.
- Ensure adherence to coding standards and best practices.
- Verify that the code is well-documented and maintainable.
- Check for proper error handling and edge cases.
- Suggest improvements for readability and structure.

## Pull Request details
{{PrContext}}
`

export function buildCodeReviewPrompt(context: ReviewPromptContext): string {
  const reviewInstructions = context.customPrompt?.trim() || DEFAULT_REVIEW_INSTRUCTIONS

  return `You are performing a code review on a pull request. More details about your task are provided below.

## How to Add Review Comments

Use the node script to create comments on specific lines. If you have a suggested fix, include it in a markdown suggestion code block within the comment.

Command MUST be like this:
\`\`\`bash
node ${context.toolPath} --file "<file_path>" --line <line_number> --comment "<your comment>"
\`\`\`

**Example:**
\`\`\`bash
node ${context.toolPath} --file "src/services/api.ts" --line 42 --comment "Consider using optional chaining here to handle potential null values."
\`\`\`

## Review Instructions

${reviewInstructions}

`.replace("{{PrContext}}", context.contextData)
}
