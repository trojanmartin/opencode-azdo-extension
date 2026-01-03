const API_VERSION = "7.1"

function getAuthHeader(pat: string): string {
  const credentials = Buffer.from(`:${pat}`).toString("base64")
  return `Basic ${credentials}`
}

async function makeRequest<T>(
  url: string,
  options: RequestInit & { headers?: Record<string, string> },
  pat: string
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: getAuthHeader(pat),
      ...options.headers,
    },
  })

  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as { message?: string }
    const message = errorData.message || response.statusText || "Unknown error"
    throw new Error(`Azure DevOps API error (${response.status}): ${message}`)
  }

  return response.json() as Promise<T>
}

interface IdentityRef {
  id: string
  displayName: string
  uniqueName: string
  url: string
}

interface Reviewer {
  id: string
  displayName: string
  vote: number
}

interface PullRequest {
  pullRequestId: number
  title: string
  description: string
  status: "active" | "completed" | "abandoned"
  sourceRefName: string
  targetRefName: string
  createdBy: IdentityRef
  creationDate: string
  repository: {
    id: string
    name: string
  }
  mergeStatus: "queued" | "conflicts" | "succeeded" | "failed"
  reviewers: Reviewer[]
  url: string
  commits?: GitCommitRef[]
}

interface GitCommitRef {
  commitId: string
  author: {
    name: string
    email: string
  }
  comment: string
  changeCounts?: {
    add: number
    edit: number
    delete: number
  }
}

interface GitPullRequestChange {
  changeId: number
  changeTrackingId: number
  changeType: "add" | "edit" | "delete" | "rename"
  item: {
    objectId: string
    path: string
  }
}

interface Comment {
  id: number
  content: string
  author: IdentityRef
  publishedDate: string
  lastUpdatedDate: string
  commentType: string
}

interface PullRequestThread {
  id: number
  comments: Comment[]
  status: "active" | "fixed" | "wontFix" | "closed" | "byDesign" | "pending"
  publishedDate: string
  lastUpdatedDate: string
  threadContext?: {
    filePath?: string
    rightFileStart?: { line: number; offset: number }
    rightFileEnd?: { line: number; offset: number }
  }
}

interface CreateThreadOptions {
  filePath?: string
  lineNumber?: number
  status?: "active" | "fixed" | "wontFix" | "closed" | "byDesign" | "pending"
}

interface SearchPullRequestsCriteria {
  status?: "active" | "completed" | "abandoned" | "all"
  sourceRefName?: string
  targetRefName?: string
  creatorId?: string
  reviewerId?: string
}

interface ThreadRequestBody {
  comments: Array<{
    content: string
    parentCommentId: number
    commentType: number
  }>
  status: number
  threadContext?: {
    filePath: string
    rightFileStart: { line: number; offset: number }
    rightFileEnd: { line: number; offset: number }
  }
}

interface CreatePullRequestOptions {
  description?: string
  reviewers?: string[]
  supportsIterations?: boolean
}

interface GetPullRequestOptions {
  includeCommits?: boolean
}

export async function getPullRequest(
  organization: string,
  project: string,
  pullRequestId: number,
  personalAccessToken: string,
  options?: GetPullRequestOptions
): Promise<PullRequest> {
  const queryParams = new URLSearchParams({
    "api-version": API_VERSION,
  })

  if (options?.includeCommits) {
    queryParams.set("includeCommits", "true")
  }

  const url = `https://dev.azure.com/${organization}/${project}/_apis/git/pullrequests/${pullRequestId}?${queryParams.toString()}`
  return makeRequest<PullRequest>(url, { method: "GET" }, personalAccessToken)
}

export async function createPullRequest(
  organization: string,
  project: string,
  repositoryId: string,
  personalAccessToken: string,
  sourceRefName: string,
  targetRefName: string,
  title: string,
  options?: CreatePullRequestOptions
): Promise<PullRequest> {
  const queryParams = new URLSearchParams({
    "api-version": API_VERSION,
  })

  if (options?.supportsIterations !== undefined) {
    queryParams.set("supportsIterations", String(options.supportsIterations))
  }

  const url = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/pullrequests?${queryParams.toString()}`

  const body = {
    sourceRefName,
    targetRefName,
    title,
    ...(options?.description && { description: options.description }),
    ...(options?.reviewers && { reviewers: options.reviewers.map((id) => ({ id })) }),
  }

  return makeRequest<PullRequest>(
    url,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    personalAccessToken
  )
}

export async function listPullRequests(
  organization: string,
  project: string,
  personalAccessToken: string,
  repositoryId?: string,
  searchCriteria?: SearchPullRequestsCriteria
): Promise<{ value: PullRequest[]; count: number }> {
  const queryParams = new URLSearchParams({
    "api-version": API_VERSION,
  })

  if (searchCriteria?.status) {
    queryParams.set("searchCriteria.status", searchCriteria.status)
  }

  if (searchCriteria?.sourceRefName) {
    queryParams.set("searchCriteria.sourceRefName", searchCriteria.sourceRefName)
  }

  if (searchCriteria?.targetRefName) {
    queryParams.set("searchCriteria.targetRefName", searchCriteria.targetRefName)
  }

  if (searchCriteria?.creatorId) {
    queryParams.set("searchCriteria.creatorId", searchCriteria.creatorId)
  }

  if (searchCriteria?.reviewerId) {
    queryParams.set("searchCriteria.reviewerId", searchCriteria.reviewerId)
  }

  if (repositoryId) {
    queryParams.set("searchCriteria.repositoryId", repositoryId)
  }

  const url = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId || ""}/pullrequests?${queryParams.toString()}`
  return makeRequest<{ value: PullRequest[]; count: number }>(
    url,
    { method: "GET" },
    personalAccessToken
  )
}

export async function createPullRequestThread(
  organization: string,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  personalAccessToken: string,
  content: string,
  options?: CreateThreadOptions
): Promise<PullRequestThread> {
  const url = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/pullRequests/${pullRequestId}/threads?api-version=${API_VERSION}`

  const body: ThreadRequestBody = {
    comments: [
      {
        content,
        parentCommentId: 0,
        commentType: 1,
      },
    ],
    status: 1,
  }

  if (options?.filePath && options.lineNumber) {
    body.threadContext = {
      filePath: options.filePath,
      rightFileStart: { line: options.lineNumber, offset: 1 },
      rightFileEnd: { line: options.lineNumber, offset: 999 },
    }
  }

  if (options?.status) {
    const statusMap: Record<string, number> = {
      active: 1,
      fixed: 2,
      wontFix: 3,
      closed: 4,
      byDesign: 5,
      pending: 6,
    }
    body.status = statusMap[options.status] || 1
  }

  return makeRequest<PullRequestThread>(
    url,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    personalAccessToken
  )
}

export async function addPullRequestComment(
  organization: string,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  threadId: number,
  personalAccessToken: string,
  content: string,
  parentCommentId?: number
): Promise<Comment> {
  const url = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/pullRequests/${pullRequestId}/threads/${threadId}/comments?api-version=${API_VERSION}`

  const body = {
    content,
    commentType: 1,
    ...(parentCommentId && { parentCommentId }),
  }

  return makeRequest<Comment>(
    url,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    personalAccessToken
  )
}

export async function editPullRequestComment(
  organization: string,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  threadId: number,
  commentId: number,
  personalAccessToken: string,
  content: string
): Promise<Comment> {
  const url = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/pullRequests/${pullRequestId}/threads/${threadId}/comments/${commentId}?api-version=${API_VERSION}`

  return makeRequest<Comment>(
    url,
    {
      method: "PATCH",
      body: JSON.stringify({ content }),
    },
    personalAccessToken
  )
}

export async function getPullRequestThreads(
  organization: string,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  personalAccessToken: string
): Promise<{ value: PullRequestThread[]; count: number }> {
  const url = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/pullRequests/${pullRequestId}/threads?api-version=${API_VERSION}`
  return makeRequest<{ value: PullRequestThread[]; count: number }>(
    url,
    { method: "GET" },
    personalAccessToken
  )
}

export async function getPullRequestThread(
  organization: string,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  threadId: number,
  personalAccessToken: string
): Promise<PullRequestThread> {
  const url = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/pullRequests/${pullRequestId}/threads/${threadId}?api-version=${API_VERSION}`
  return makeRequest<PullRequestThread>(url, { method: "GET" }, personalAccessToken)
}

export async function getPullRequestCommits(
  organization: string,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  personalAccessToken: string
): Promise<GitCommitRef[]> {
  const url = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/pullRequests/${pullRequestId}/commits?api-version=${API_VERSION}`
  return makeRequest<GitCommitRef[]>(url, { method: "GET" }, personalAccessToken)
}

export async function getPullRequestIterationChanges(
  organization: string,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  iterationId: number,
  personalAccessToken: string
): Promise<{ changeEntries: GitPullRequestChange[] }> {
  const url = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/pullRequests/${pullRequestId}/iterations/${iterationId}/changes?api-version=${API_VERSION}`
  return makeRequest<{ changeEntries: GitPullRequestChange[] }>(
    url,
    { method: "GET" },
    personalAccessToken
  )
}

export async function getPullRequestIterations(
  organization: string,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  personalAccessToken: string
): Promise<{ value: Array<{ id: number; description: string }>; count: number }> {
  const url = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/pullRequests/${pullRequestId}/iterations?api-version=${API_VERSION}`
  return makeRequest<{ value: Array<{ id: number; description: string }>; count: number }>(
    url,
    { method: "GET" },
    personalAccessToken
  )
}
