/**
 * API Endpoints Inventory Scanner
 * Сканирует все маршруты и выводит список доступных API endpoints
 */

import fs from 'fs';
import path from 'path';

interface EndpointInfo {
  method: string;
  path: string;
  file: string;
  line: number;
}

const routesDir = path.join(process.cwd(), 'server/routes');
const endpoints: EndpointInfo[] = [];

function scanFile(filePath: string, relativePath: string) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
  // Регулярки для поиска определений маршрутов
  const routePatterns = [
    /\.get\(['"]([^'"]+)['"]/g,
    /\.post\(['"]([^'"]+)['"]/g,
    /\.put\(['"]([^'"]+)['"]/g,
    /\.patch\(['"]([^'"]+)['"]/g,
    /\.delete\(['"]([^'"]+)['"]/g,
  ];
  
  lines.forEach((line, index) => {
    routePatterns.forEach((pattern, methodIndex) => {
      const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
      const method = methods[methodIndex];
      
      const matches = [...line.matchAll(pattern)];
      matches.forEach(match => {
        if (match[1]) {
          endpoints.push({
            method,
            path: match[1],
            file: relativePath,
            line: index + 1,
          });
        }
      });
    });
  });
}

function scanDirectory(dir: string, baseDir: string = dir) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      scanDirectory(fullPath, baseDir);
    } else if (file.endsWith('.ts') && !file.endsWith('.test.ts')) {
      const relativePath = path.relative(baseDir, fullPath);
      scanFile(fullPath, relativePath);
    }
  });
}

console.log('\n🔍 Сканирование API endpoints...\n');
scanDirectory(routesDir);

// Группировка по файлам
const byFile = endpoints.reduce((acc, ep) => {
  if (!acc[ep.file]) {
    acc[ep.file] = [];
  }
  acc[ep.file].push(ep);
  return acc;
}, {} as Record<string, EndpointInfo[]>);

// Вывод результатов
Object.keys(byFile).sort().forEach(file => {
  console.log(`\n📄 ${file}`);
  console.log('─'.repeat(80));
  byFile[file].forEach(ep => {
    console.log(`  ${ep.method.padEnd(7)} ${ep.path.padEnd(50)} (line ${ep.line})`);
  });
});

console.log(`\n✅ Всего найдено endpoints: ${endpoints.length}\n`);

// Сохранение в JSON для анализа
const outputPath = path.join(process.cwd(), 'docs/api-endpoints-inventory.json');
fs.writeFileSync(outputPath, JSON.stringify(endpoints, null, 2));
console.log(`📝 Результаты сохранены в: ${outputPath}\n`);
