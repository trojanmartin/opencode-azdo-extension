#!/bin/bash
#
# Add Review Comment Tool
#
# Usage:
#   ./add-review-comment.sh --file <path> --line <number> --comment "<text>"
#
# Required environment variables:
#   AZURE_DEVOPS_ORG
#   AZURE_DEVOPS_PROJECT
#   AZURE_DEVOPS_REPO_ID
#   AZURE_DEVOPS_PR_ID
#   AZURE_DEVOPS_PAT
#

set -euo pipefail

while [[ $# -gt 0 ]]; do
  case $1 in
    --file|-f)
      FILE_PATH="$2"
      shift 2
      ;;
    --line|-l)
      LINE_NUMBER="$2"
      shift 2
      ;;
    --comment|-c)
      COMMENT_TEXT="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${FILE_PATH:-}" || -z "${LINE_NUMBER:-}" || -z "${COMMENT_TEXT:-}" ]]; then
  echo "Usage: add-review-comment.sh --file <path> --line <number> --comment <text>" >&2
  exit 1
fi

for var in AZURE_DEVOPS_ORG AZURE_DEVOPS_PROJECT AZURE_DEVOPS_REPO_ID AZURE_DEVOPS_PR_ID AZURE_DEVOPS_PAT; do
  if [[ -z "${!var:-}" ]]; then
    echo "Missing required environment variable: $var" >&2
    exit 1
  fi
done

API_URL="https://dev.azure.com/${AZURE_DEVOPS_ORG}/${AZURE_DEVOPS_PROJECT}/_apis/git/repositories/${AZURE_DEVOPS_REPO_ID}/pullRequests/${AZURE_DEVOPS_PR_ID}/threads?api-version=7.1"

if [[ "$FILE_PATH" != /* ]]; then
  FILE_PATH="/$FILE_PATH"
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Warning: jq is not installed. Cannot escape comment text safely." >&2
  exit 0
fi

ESCAPED_COMMENT=$(jq -Rs . <<<"$COMMENT_TEXT")

read -r -d '' REQUEST_BODY <<EOF || true
{
  "comments": [
    {
      "content": ${ESCAPED_COMMENT},
      "commentType": 1
    }
  ],
  "status": 1,
  "threadContext": {
    "filePath": "${FILE_PATH}",
    "rightFileStart": {
      "line": ${LINE_NUMBER},
      "offset": 1
    },
    "rightFileEnd": {
      "line": ${LINE_NUMBER},
      "offset": 1
    }
  }
}
EOF

AUTH=$(printf ':%s' "$AZURE_DEVOPS_PAT" | base64)

RESPONSE=$(curl -sS -w "\n%{http_code}" -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $AUTH" \
  -d "$REQUEST_BODY") || {
    echo "Warning: curl request failed" >&2
    exit 0
  }

HTTP_CODE=$(tail -n1 <<<"$RESPONSE")
BODY=$(sed '$d' <<<"$RESPONSE")

if [[ "$HTTP_CODE" -ge 200 && "$HTTP_CODE" -lt 300 ]]; then
  echo "Comment added to ${FILE_PATH}:${LINE_NUMBER}"
else
  echo "Warning: Failed to add comment (HTTP $HTTP_CODE): $BODY" >&2
fi
