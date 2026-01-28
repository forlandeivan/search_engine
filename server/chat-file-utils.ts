/**
 * Утилиты для работы с файлами в чате
 */

// Поддерживаемые текстовые форматы
export const TEXT_FILE_EXTENSIONS = ['.pdf', '.docx', '.doc', '.txt'] as const;
export const TEXT_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
] as const;

// Поддерживаемые аудио форматы (из yandex-stt-service.ts)
export const AUDIO_FILE_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.webm', '.opus'] as const;
export const AUDIO_MIME_TYPES = [
  'audio/mp3',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/opus',
  'audio/webm',
] as const;

// Лимиты
export const MAX_EXTRACTED_TEXT_CHARS = 100_000;
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

export type FileCategory = 'audio' | 'document' | 'unsupported';

/**
 * Получить расширение файла (lowercase, с точкой)
 */
export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filename.slice(lastDot).toLowerCase();
}

/**
 * Проверить, является ли файл текстовым документом
 */
export function isTextFile(mimeType: string | null, filename: string): boolean {
  const ext = getFileExtension(filename);
  if (TEXT_FILE_EXTENSIONS.includes(ext as any)) return true;
  if (mimeType && TEXT_MIME_TYPES.includes(mimeType as any)) return true;
  return false;
}

/**
 * Проверить, является ли файл аудио
 */
export function isAudioFile(mimeType: string | null, filename: string): boolean {
  const ext = getFileExtension(filename);
  if (AUDIO_FILE_EXTENSIONS.includes(ext as any)) return true;
  if (mimeType && AUDIO_MIME_TYPES.includes(mimeType as any)) return true;
  return false;
}

/**
 * Определить категорию файла
 */
export function getFileCategory(mimeType: string | null, filename: string): FileCategory {
  if (isAudioFile(mimeType, filename)) return 'audio';
  if (isTextFile(mimeType, filename)) return 'document';
  return 'unsupported';
}

/**
 * Получить человекочитаемое название типа файла
 */
export function getFileTypeLabel(mimeType: string | null, filename: string): string {
  const ext = getFileExtension(filename);
  switch (ext) {
    case '.pdf': return 'PDF документ';
    case '.docx': return 'Word документ';
    case '.doc': return 'Word документ (legacy)';
    case '.txt': return 'Текстовый файл';
    case '.mp3': return 'Аудио MP3';
    case '.wav': return 'Аудио WAV';
    case '.ogg': return 'Аудио OGG';
    case '.webm': return 'Аудио WebM';
    case '.opus': return 'Аудио Opus';
    default: return 'Файл';
  }
}

/**
 * Валидация файла перед загрузкой
 */
export function validateChatFile(file: {
  size: number;
  mimeType: string | null;
  filename: string;
}): { valid: boolean; category?: FileCategory; error?: string } {
  // Проверка размера
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { 
      valid: false, 
      error: `Файл слишком большой. Максимум: ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB` 
    };
  }

  // Определение категории
  const category = getFileCategory(file.mimeType, file.filename);
  if (category === 'unsupported') {
    const ext = getFileExtension(file.filename);
    return { 
      valid: false, 
      error: `Неподдерживаемый формат файла: ${ext || 'неизвестный'}. Поддерживаются: PDF, DOCX, DOC, TXT, MP3, WAV, OGG` 
    };
  }

  return { valid: true, category };
}
