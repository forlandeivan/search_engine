from pathlib import Path
path = Path('e2e/chat.spec.ts')
lines = path.read_text(encoding='utf-8').splitlines()
line_value = "test(\"\\u041d\\u043e\\u0432\\u044b\\u0439 \\u0447\\u0430\\u0442 \\u043d\\u0430 \\u0431\\u0430\\u0437\\u0435 Unica Chat\\", async ({ page }) => {"
lines[5] = bytes(line_value, 'utf-8').decode('unicode_escape')
message_value = "  const message = \"\\u041f\\u0440\\u0438\\u0432\\u0435\\u0442! \\u041a\\u0430\\u043a \\u0434\\u0435\\043b\\u0430?\\""
lines[20] = bytes(message_value, 'utf-8').decode('unicode_escape')
path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
