import fetch from "node-fetch";
import { Headers } from "node-fetch";
import { applyTlsPreferences } from "../http-utils";

/**
 * Dev-утилита: ручная проверка доступных моделей AITunnel.
 * Не вызывается в проде. Запуск: `TS_NODE_TRANSPILE_ONLY=1 ts-node server/dev/check-aitunnel-models.ts`
 * Требуется переменная окружения AITUNNEL_API_KEY.
 */
async function main() {
  const apiKey = process.env.AITUNNEL_API_KEY;
  if (!apiKey) {
    console.error("AITUNNEL_API_KEY не задан. Укажи ключ и запусти снова.");
    process.exit(1);
  }

  const headers = new Headers();
  headers.set("Authorization", `Bearer ${apiKey}`);
  headers.set("Accept", "application/json");

  const request = applyTlsPreferences(
    {
      method: "GET",
      headers,
    },
    false,
  );

  const url = "https://api.aitunnel.ru/v1/models";
  console.log(`[dev] GET ${url}`);
  const response = await fetch(url, request);
  const text = await response.text();
  console.log(`[dev] status=${response.status}`);
  console.log(text);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
