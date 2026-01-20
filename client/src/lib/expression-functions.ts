export interface ExpressionFunction {
  name: string;
  description: string;
  returnType: 'string' | 'number' | 'boolean' | 'object';
  category: 'generator' | 'string' | 'date' | 'math';
  args?: {
    name: string;
    type: string;
    required: boolean;
    description: string;
  }[];
  // Для клиентского preview (опционально)
  previewExecutor?: (args: string[]) => string;
}

/**
 * Реестр доступных функций
 */
export const EXPRESSION_FUNCTIONS: ExpressionFunction[] = [
  // === Генераторы ===
  {
    name: 'NewGUID',
    description: 'Генерирует уникальный UUID (v4) для каждой записи',
    returnType: 'string',
    category: 'generator',
    previewExecutor: () => '[UUID будет сгенерирован]',
  },
  
  // === Строковые (будущее) ===
  // {
  //   name: 'trim',
  //   description: 'Удаляет пробелы в начале и конце строки',
  //   returnType: 'string',
  //   category: 'string',
  //   args: [{ name: 'value', type: 'string', required: true, description: 'Исходная строка' }],
  // },
  // {
  //   name: 'lowercase',
  //   description: 'Преобразует строку в нижний регистр',
  //   returnType: 'string',
  //   category: 'string',
  //   args: [{ name: 'value', type: 'string', required: true, description: 'Исходная строка' }],
  // },
  // {
  //   name: 'uppercase',
  //   description: 'Преобразует строку в верхний регистр',
  //   returnType: 'string',
  //   category: 'string',
  //   args: [{ name: 'value', type: 'string', required: true, description: 'Исходная строка' }],
  // },
  // {
  //   name: 'substring',
  //   description: 'Извлекает часть строки',
  //   returnType: 'string',
  //   category: 'string',
  //   args: [
  //     { name: 'value', type: 'string', required: true, description: 'Исходная строка' },
  //     { name: 'start', type: 'number', required: true, description: 'Начальный индекс' },
  //     { name: 'end', type: 'number', required: false, description: 'Конечный индекс' },
  //   ],
  // },
];

/**
 * Получение функции по имени
 */
export function getExpressionFunction(name: string): ExpressionFunction | undefined {
  return EXPRESSION_FUNCTIONS.find(f => f.name === name);
}

/**
 * Получение функций по категории
 */
export function getExpressionFunctionsByCategory(category: ExpressionFunction['category']): ExpressionFunction[] {
  return EXPRESSION_FUNCTIONS.filter(f => f.category === category);
}

/**
 * Проверка существования функции
 */
export function isValidFunction(name: string): boolean {
  return EXPRESSION_FUNCTIONS.some(f => f.name === name);
}
