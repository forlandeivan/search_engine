export type ChatSummary = {
  id: string;
  workspaceId: string;
  userId: string;
  skillId: string;
  skillName?: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatPayload = {
  workspaceId: string;
  skillId: string;
  title?: string;
};

export type ChatMessage = {
  id: string;
  chatId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};
