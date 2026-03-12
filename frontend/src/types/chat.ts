export type LocaleCode = 'en' | 'ja' | 'zh' | 'ko';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  variant: 'text' | 'result' | 'ambiguity' | 'error';
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  preview: string;
  isPinned: boolean;
  updatedAt: string;
  messages: ChatMessage[];
}