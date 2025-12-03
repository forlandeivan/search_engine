from pathlib import Path
text = Path('client/src/pages/ChatPage.tsx').read_text(encoding='utf-8')
start = text.index('const handleTranscription = useCallback')
end = text.index('const isNewChat')
new = """const handleTranscription = useCallback(
    async (transcribedText: string) => {
      if (!workspaceId) return;
      setIsTranscribing(true);

      if (!transcribedText.startsWith('__PENDING_OPERATION:')) {
        setIsTranscribing(false);
        return;
      }

      const parts = transcribedText.substring('__PENDING_OPERATION:'.length).split(':');
      const operationId = parts[0];
      const fileName = parts[1] ? decodeURIComponent(parts[1]) : 'audio';

      let targetChatId = effectiveChatId;
      if (!targetChatId) {
        const skillId = activeChat?.skillId ?? activeSkill?.id ?? defaultSkill?.id;
        if (!skillId) {
          setStreamError('Unica Chat skill is not configured. Please contact the administrator.');
          setIsTranscribing(false);
          return;
        }
        try {
          const newChat = await createChat({ workspaceId, skillId });
          targetChatId = newChat.id;
          setOverrideChatId(newChat.id);
          handleSelectChat(newChat.id);
        } catch (error):
          setStreamError(error.message if isinstance(error, Exception) else str(error))
          setIsTranscribing(False)
          return

      if targetChatId:
        const userMessage = buildLocalMessage('user', targetChatId, fileName)
        const assistantMessage: ChatMessage = {
          id: `local-transcript-${Date.now()}`,
          chatId: targetChatId,
          role: 'assistant',
          content: 'Аудиозапись загружена. Идёт расшифровка...',
          metadata: {
            type: 'transcript',
            transcriptStatus: 'processing',
          },
          createdAt: new Date().toISOString(),
        };
        setLocalChatId(targetChatId);
        setLocalMessages((prev) => [...prev, userMessage, assistantMessage]);

      const pollOperation = async () => {
        let attempts = 0;
        const maxAttempts = 600;

        while (attempts < maxAttempts) {
          try {
            const response = await fetch(`/api/chat/transcribe/operations/${operationId}`, {
              method: 'GET',
              credentials: 'include',
            });

            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }

            const status = await response.json();

            if (status.status === 'completed') {
              await queryClient.invalidateQueries({ queryKey: ['chat-messages'] });
              return;
            }

            if (status.status === 'failed') {
              setStreamError(status.error || 'Транскрибация не удалась. Попробуйте снова.');
              return;
            }

            await new Promise((resolve) => setTimeout(resolve, 1000));
            attempts += 1;
          } catch (error) {
            console.error('[ChatPage] Poll error:', error);
            await new Promise((resolve) => setTimeout(resolve, 1000));
            attempts += 1;
          }
        }

        setStreamError('Транскрибация заняла слишком много времени. Попробуйте снова.');
      };

      await pollOperation();
      setIsTranscribing(false);
    },
    [activeChat?.skillId, activeSkill?.id, createChat, defaultSkill?.id, effectiveChatId, handleSelectChat, queryClient, workspaceId],
  );

"""
Path('client/src/pages/ChatPage.tsx').write_text(text[:start] + new + text[end:], encoding='utf-8')
