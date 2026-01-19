import { test, expect, type Page } from "@playwright/test";
import { saveSuccessScreenshot } from "./utils/success-screenshot";

const ADMIN_EMAIL = process.env.TEST_USER_EMAIL || process.env.E2E_EMAIL;
const ADMIN_PASSWORD = process.env.TEST_USER_PASSWORD || process.env.E2E_PASSWORD;

const login = async (page: Page) => {
  await page.goto("/");
  // Логин через API, чтобы избежать проблем с формой
  const loginResponse = await page.request.post("/api/auth/login", {
    form: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginResponse.ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId("link-chat")).toBeVisible({ timeout: 15_000 });
};

test.describe("Embedding Providers CRUD", () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, "Admin credentials are not configured");

  test("should create, save, and delete embedding provider", async ({ page }, testInfo) => {
    test.setTimeout(120_000);

    // Собираем все логи консоли
    const consoleMessages: Array<{ type: string; text: string }> = [];
    page.on("console", (msg) => {
      const text = msg.text();
      consoleMessages.push({ type: msg.type(), text });
      if (msg.type() === "error") {
        console.log(`[CONSOLE ERROR]: ${text}`);
      }
    });

    // Собираем все сетевые запросы и ответы
    const networkRequests: Array<{
      url: string;
      method: string;
      status: number;
      requestBody?: string;
      responseBody?: string;
    }> = [];

    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("/api/")) {
        const request = response.request();
        let requestBody = "";
        let responseBody = "";

        try {
          const postData = request.postData();
          if (postData) {
            requestBody = postData;
          }
        } catch (e) {
          // ignore
        }

        try {
          responseBody = await response.text();
        } catch (e) {
          // ignore
        }

        networkRequests.push({
          url,
          method: request.method(),
          status: response.status(),
          requestBody,
          responseBody,
        });

        // Логируем ошибки API
        if (!response.ok()) {
          console.log(`[API ERROR] ${request.method()} ${url}: ${response.status()}`);
          console.log(`Response: ${responseBody.substring(0, 500)}`);
        }
      }
    });

    // Перехватываем ошибки страницы
    page.on("pageerror", (error) => {
      console.log(`[PAGE ERROR]: ${error.message}`);
      console.log(`Stack: ${error.stack}`);
    });

    // Перехватываем необработанные исключения
    page.on("requestfailed", (request) => {
      console.log(`[REQUEST FAILED]: ${request.method()} ${request.url()}`);
      console.log(`Failure: ${request.failure()?.errorText}`);
    });

    await test.step("Авторизация", async () => {
      await login(page);
    });

    let createdProviderId: string | null = null;
    const providerName = `E2E Embedding Provider ${Date.now()}`;

    try {
      await test.step("Переход на страницу embeddings провайдеров", async () => {
        await page.goto("/admin/embeddings", { waitUntil: "networkidle" });
        await page.waitForLoadState("networkidle", { timeout: 15_000 });
        await expect(page.getByText("Управление эмбеддингами")).toBeVisible({ timeout: 10_000 });
      });

      await test.step("Создание нового провайдера", async () => {
        // Кликаем на кнопку "Добавить сервис"
        const addButton = page.getByRole("button", { name: /Добавить сервис/i });
        await expect(addButton).toBeVisible({ timeout: 5000 });
        await addButton.click();

        // Ждем появления формы
        await page.waitForTimeout(500);

        // Заполняем форму
        await page.getByLabel("Название").fill(providerName);
        await page.getByLabel("Endpoint для получения токена").fill("https://ngw.devices.sberbank.ru:9443/api/v2/oauth");
        await page.getByLabel("Endpoint сервиса эмбеддингов").fill("https://gigachat.devices.sberbank.ru/api/v1/embeddings");
        await page.getByLabel("Authorization key").fill("test-key");
        await page.getByLabel("OAuth scope").fill("GIGACHAT_API_PERS");
        await page.getByLabel("Модель эмбеддингов").fill("GigaChat-2");

        // Сохраняем провайдер
        const saveResponsePromise = page.waitForResponse(
          (response) =>
            response.url().includes("/api/embedding/services") &&
            response.request().method() === "POST" &&
            response.status() === 201,
          { timeout: 15_000 }
        );

        const saveButton = page.getByRole("button", { name: /Создать сервис/i });
        await expect(saveButton).toBeVisible();
        await saveButton.click();

        const saveResponse = await saveResponsePromise;
        const saveBody = (await saveResponse.json()) as { provider?: { id: string } };
        createdProviderId = saveBody.provider?.id ?? null;

        expect(createdProviderId, "Provider ID должен быть создан").toBeTruthy();
        console.log(`Created provider ID: ${createdProviderId}`);

        // Ждем появления тоста об успехе
        await expect(page.getByText(/создан|успешно/i)).toBeVisible({ timeout: 5000 });
      });

      await test.step("Проверка что провайдер появился в списке", async () => {
        await page.waitForTimeout(1000);
        await expect(page.getByText(providerName)).toBeVisible({ timeout: 5000 });
      });

      await test.step("Выбор созданного провайдера для редактирования", async () => {
        // Кликаем на провайдера в списке
        const providerCard = page.locator(`text=${providerName}`).first();
        await expect(providerCard).toBeVisible();
        await providerCard.click();

        // Ждем загрузки формы редактирования
        await page.waitForTimeout(500);
        await expect(page.getByLabel("Название")).toHaveValue(providerName);
      });

      await test.step("Удаление провайдера", async () => {
        expect(createdProviderId, "Provider ID должен быть установлен").toBeTruthy();

        // Настраиваем перехват диалога confirm
        page.on("dialog", async (dialog) => {
          console.log(`[DIALOG]: ${dialog.type()} - ${dialog.message()}`);
          await dialog.accept();
        });

        // Ждем DELETE запроса
        const deleteResponsePromise = page.waitForResponse(
          (response) =>
            response.url().includes(`/api/embedding/services/${createdProviderId}`) &&
            response.request().method() === "DELETE",
          { timeout: 15_000 }
        );

        // Кликаем на кнопку удаления
        const deleteButton = page.getByRole("button", { name: /Удалить провайдера/i });
        await expect(deleteButton).toBeVisible({ timeout: 5000 });
        await deleteButton.click();

        const deleteResponse = await deleteResponsePromise;
        console.log(`Delete response status: ${deleteResponse.status()}`);
        console.log(`Delete response URL: ${deleteResponse.url()}`);

        // Проверяем что удаление успешно (204 или 200)
        expect(
          [200, 204].includes(deleteResponse.status()),
          `DELETE должен вернуть 200 или 204, но вернул ${deleteResponse.status()}`
        ).toBeTruthy();

        const deleteBody = await deleteResponse.text().catch(() => "");
        console.log(`Delete response body: ${deleteBody}`);

        // Ждем обновления списка
        await page.waitForTimeout(1000);
        await expect(page.getByText(providerName)).not.toBeVisible({ timeout: 5000 });
      });

      await test.step("Проверка логов на ошибки", async () => {
        // Выводим все ошибки консоли
        const errorLogs = consoleMessages.filter((m) => m.type === "error");
        if (errorLogs.length > 0) {
          console.log("\n=== CONSOLE ERRORS ===");
          errorLogs.forEach((log) => {
            console.log(`[${log.type}]: ${log.text}`);
          });
          console.log("=====================\n");
        }

        // Выводим все неуспешные API запросы
        const failedRequests = networkRequests.filter((r) => !r.status.toString().startsWith("2"));
        if (failedRequests.length > 0) {
          console.log("\n=== FAILED API REQUESTS ===");
          failedRequests.forEach((req) => {
            console.log(`${req.method} ${req.url}: ${req.status}`);
            if (req.requestBody) {
              console.log(`Request body: ${req.requestBody.substring(0, 200)}`);
            }
            if (req.responseBody) {
              console.log(`Response body: ${req.responseBody.substring(0, 500)}`);
            }
          });
          console.log("==========================\n");
        }

        // Проверяем DELETE запрос
        const deleteRequests = networkRequests.filter(
          (r) => r.method === "DELETE" && r.url.includes("/api/embedding/services")
        );
        console.log("\n=== DELETE REQUESTS ===");
        deleteRequests.forEach((req) => {
          console.log(`${req.method} ${req.url}: ${req.status}`);
          if (req.responseBody) {
            console.log(`Response: ${req.responseBody}`);
          }
        });
        console.log("======================\n");

        // Проверяем что нет критических ошибок
        const criticalErrors = errorLogs.filter((log) =>
          log.text.includes("Cannot read") ||
          log.text.includes("is not a function") ||
          log.text.includes("404") ||
          log.text.includes("API endpoint not found")
        );

        if (criticalErrors.length > 0) {
          console.log("\n=== CRITICAL ERRORS FOUND ===");
          criticalErrors.forEach((err) => {
            console.log(`CRITICAL: ${err.text}`);
          });
          console.log("============================\n");
          throw new Error(`Найдены критические ошибки: ${criticalErrors.map((e) => e.text).join(", ")}`);
        }

        // Проверяем что DELETE запрос был успешным
        const successfulDelete = deleteRequests.find((r) => [200, 204].includes(r.status));
        if (!successfulDelete) {
          const failedDelete = deleteRequests.find((r) => r.status === 404);
          if (failedDelete) {
            throw new Error(
              `DELETE запрос вернул 404: ${failedDelete.url}\nResponse: ${failedDelete.responseBody}`
            );
          }
          throw new Error(`DELETE запрос не был успешным. Статусы: ${deleteRequests.map((r) => r.status).join(", ")}`);
        }
      });

      await test.step("Скриншот успешного завершения", async () => {
        await saveSuccessScreenshot(page, testInfo);
      });
    } catch (error) {
      // В случае ошибки делаем скриншот и выводим все логи
      console.log("\n=== TEST FAILED - ALL LOGS ===");
      console.log("Console messages:", JSON.stringify(consoleMessages, null, 2));
      console.log("Network requests:", JSON.stringify(networkRequests, null, 2));
      console.log("=============================\n");

      await page.screenshot({
        path: `test-results/embedding-providers-error-${Date.now()}.png`,
        fullPage: true,
      });

      throw error;
    } finally {
      // Cleanup: если провайдер не был удален, удаляем его через API
      if (createdProviderId) {
        try {
          const cleanupResponse = await page.request.delete(`/api/embedding/services/${createdProviderId}`);
          if (cleanupResponse.ok()) {
            console.log(`Cleaned up provider ${createdProviderId}`);
          }
        } catch (e) {
          console.log(`Failed to cleanup provider ${createdProviderId}:`, e);
        }
      }
    }
  });
});
