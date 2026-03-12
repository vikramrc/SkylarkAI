import type { ChatMessage, Conversation } from '@/types/chat';

const STORAGE_KEY = 'skylarkai.mock.conversations';

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function createMessage(
  role: ChatMessage['role'],
  content: string,
  variant: ChatMessage['variant'] = 'text',
) {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    variant,
    createdAt: new Date().toISOString(),
  } satisfies ChatMessage;
}

function seedConversations(): Conversation[] {
  return [
    {
      id: crypto.randomUUID(),
      title: 'Expired certificates overview',
      preview: 'Representative backend-style result rendering for UI-first shell work.',
      isPinned: true,
      updatedAt: new Date().toISOString(),
      messages: [
        createMessage('user', 'Show me all expired certificates.'),
        createMessage(
          'assistant',
          'Mock result block\n• 101 expired certificates found\n• Highest concentration: vessel documentation and equipment records\n• Next UI step: render backend-returned tables inline without changing orchestration.',
          'result',
        ),
      ],
    },
    {
      id: crypto.randomUUID(),
      title: 'Maintenance due next month',
      preview: 'Pinned/recent grouping, preview text, and conversation retrieval are mocked locally.',
      isPinned: false,
      updatedAt: new Date(Date.now() - 1000 * 60 * 40).toISOString(),
      messages: [
        createMessage('user', 'Show me maintenance due next month.'),
        createMessage(
          'assistant',
          'Mock result block\n• 101 maintenance tasks due next month\n• Top categories: inspection, lubrication, safety checks\n• Mobile drawer and desktop sidebar should surface this thread identically.',
          'result',
        ),
      ],
    },
  ];
}

function persistConversations(conversations: Conversation[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
}

function loadConversations() {
  const raw = localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    const seeded = seedConversations();
    persistConversations(seeded);
    return seeded;
  }

  try {
    return JSON.parse(raw) as Conversation[];
  } catch {
    const seeded = seedConversations();
    persistConversations(seeded);
    return seeded;
  }
}

function buildAssistantReply(prompt: string): ChatMessage {
  const normalized = prompt.toLowerCase();

  if (normalized.includes('expired certificate')) {
    return createMessage(
      'assistant',
      'Mock result block\n• 101 expired certificates found\n• Filters, table rendering, and export affordances stay in the UI only\n• MCP vs MongoQL selection remains backend-owned.',
      'result',
    );
  }

  if (normalized.includes('maintenance')) {
    return createMessage(
      'assistant',
      'Mock result block\n• 101 maintenance tasks due next month\n• Result cards here stand in for backend-originated structured payloads\n• Later wiring should swap transport only, not shell behavior.',
      'result',
    );
  }

  if (normalized.includes('pump') || normalized.includes('engine')) {
    return createMessage(
      'assistant',
      'Mock ambiguity state\nI can show engine maintenance, pump failures, or equipment certificates. The final backend will decide the disambiguation policy; the UI should only render it clearly.',
      'ambiguity',
    );
  }

  return createMessage(
    'assistant',
    'Mock assistant response\nThe initial UI shell is working on local data so layout, i18n, empty states, and responsive behavior can be finalized before real backend transport is attached.',
  );
}

function toPreview(message: string) {
  return message.replace(/\s+/g, ' ').slice(0, 90);
}

export const mockChatService = {
  async listConversations() {
    await delay(300);
    return loadConversations();
  },

  async getConversation(id: string) {
    await delay(220);
    return loadConversations().find((conversation) => conversation.id === id) ?? null;
  },

  async togglePin(id: string) {
    const conversations = loadConversations().map((conversation) =>
      conversation.id === id
        ? { ...conversation, isPinned: !conversation.isPinned, updatedAt: new Date().toISOString() }
        : conversation,
    );
    persistConversations(conversations);
    return conversations.find((conversation) => conversation.id === id)!;
  },

  async deleteConversation(id: string) {
    const conversations = loadConversations().filter((conversation) => conversation.id !== id);
    persistConversations(conversations);
  },

  async sendPrompt(currentConversationId: string | null, prompt: string) {
    await delay(450);
    const conversations = loadConversations();
    const now = new Date().toISOString();
    const userMessage = createMessage('user', prompt);
    const assistantReply = buildAssistantReply(prompt);

    let target = currentConversationId
      ? conversations.find((conversation) => conversation.id === currentConversationId) ?? null
      : null;

    if (!target) {
      target = {
        id: crypto.randomUUID(),
        title: prompt.slice(0, 48),
        preview: toPreview(prompt),
        isPinned: false,
        updatedAt: now,
        messages: [],
      } satisfies Conversation;
      conversations.unshift(target);
    }

    target.messages = [...target.messages, userMessage, assistantReply];
    target.preview = toPreview(assistantReply.content);
    target.updatedAt = now;

    persistConversations(conversations);
    return target;
  },
};