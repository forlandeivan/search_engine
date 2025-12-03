# -*- coding: utf-8 -*-
from pathlib import Path
text = Path('client/src/pages/ChatPage.tsx').read_text(encoding='utf-8')
start = text.index('const handleTranscription = useCallback')
end = text.index('const isNewChat')
new = """const handleTranscription = useCallback(
    async (transcribedText: string) => {
      if (!workspaceId) return;
      setIsTranscribing(true);

      if (!transcribedText.startswith('__PENDING_OPERATION:')) {
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
        userMessage = buildLocalMessage('user', targetChatId, fileName)
        assistantMessage = {
          'id': f"local-transcript-{int(__import__('time').time()*1000)}",
          'chatId': targetChatId,
          'role': 'assistant',
          'content': 'Аудиозапись загружена. Идёт расшифровка...',
          'metadata': { 'type': 'transcript', 'transcriptStatus': 'processing' },
          'createdAt': __import__('datetime').datetime.utcnow().isoformat() + 'Z',
        }
        setLocalChatId(targetChatId)
        setLocalMessages(lambda prev: [*prev, userMessage, assistantMessage])

      async def poll():
        attempts = 0
        max_attempts = 600
        while attempts < max_attempts:
          try:
            import requests
            r = requests.get(f"/api/chat/transcribe/operations/{operationId}", headers={}, timeout=5)
            if r.status_code != 200:
              raise RuntimeError(r.status_code)
            status = r.json()
            if status.get('status') == 'completed':
              await queryClient.invalidateQueries({ 'queryKey': ['chat-messages'] })
              return
            if status.get('status') == 'failed':
              setStreamError(status.get('error') or 'Транскрибация не удалась. Попробуйте снова.')
              return
          except Exception as exc:
            pass
          import time
          time.sleep(1)
          attempts += 1
        setStreamError('Транскрибация заняла слишком много времени. Попробуйте снова.')

      await poll()
      setIsTranscribing(false);
    },
    [activeChat?.skillId, activeSkill?.id, createChat, defaultSkill?.id, effectiveChatId, handleSelectChat, queryClient, workspaceId],
  );

"""
Path('client/src/pages/ChatPage.tsx').write_text(text[:start] + new + text[end:], encoding='utf-8')
