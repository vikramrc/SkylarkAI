export type Status = 'processing' | 'ambiguous' | 'completed' | 'error';

export interface ResultsRef {
  gridFSFileId?: string;
  filename?: string;
  contentType?: string;
  bucketName?: string;
  compressed?: boolean;
  _id?: string;
  fileId?: string;
}

export interface ClarifyingQuestionOption { id: string; label: string }
export type ClarifyingQuestionType = 'single' | 'multi' | 'text';

export interface ClarifyingQuestion {
  id: string;
  text: string;
  type?: ClarifyingQuestionType;
  options?: ClarifyingQuestionOption[];
  required?: boolean;
}

export interface Assumption {
  id: string;
  text: string;
  chosen?: boolean;
  reason?: string;
}

export interface Conversation {
  conversationId: string;
  userQuery: string;
  resolvedQuery?: string;
  status: Status;
  generatedQuery?: unknown;
  selectedIntents?: unknown[];
  targetCollections?: unknown[];
  results?: unknown[];
  resultsRef?: ResultsRef;
  executionMetadata?: unknown;
  clarifyingQuestions?: ClarifyingQuestion[];
  assumptions?: Assumption[];
  disambiguationLog?: unknown;
  relatedConversationId?: string;
  isPinned: boolean;
  deleted?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListConversationsResponse {
  conversations: Conversation[];
  total: number;
  page: number;
  pageSize: number;
  phoenixUseStream?: boolean;
}

