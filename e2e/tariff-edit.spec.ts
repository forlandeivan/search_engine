import { test, expect } from "@playwright/test";

test.describe("Tariff Edit", () => {
  test("should save credits and noCode toggle correctly", async ({ page }) => {
    // Собираем логи консоли
    const consoleMessages: string[] = [];
    page.on("console", (msg) => {
      const text = msg.text();
      consoleMessages.push(`[${msg.type()}] ${text}`);
      console.log(`[BROWSER ${msg.type().toUpperCase()}]`, text);
    });

    // Собираем сетевые запросы
    const networkRequests: Array<{ method: string; url: string; postData?: any }> = [];
    const networkResponses: Array<{ url: string; status: number; body?: any }> = [];

    page.on("request", (request) => {
      if (request.url().includes("/api/")) {
        const postData = request.postDataJSON();
        networkRequests.push({
          method: request.method(),
          url: request.url(),
          postData,
        });
        console.log(`[REQUEST] ${request.method()} ${request.url()}`, postData ? JSON.stringify(postData) : "");
      }
    });

    page.on("response", async (response) => {
      if (response.url().includes("/api/")) {
        let body: any;
        try {
          body = await response.json();
        } catch {
          // ignore
        }
        networkResponses.push({
          url: response.url(),
          status: response.status(),
          body,
        });
        console.log(`[RESPONSE] ${response.status()} ${response.url()}`, body ? JSON.stringify(body) : "");
      }
    });

    await test.step("Авторизация", async () => {
      await page.goto("http://localhost:5000/");
      await page.waitForLoadState("networkidle");

      const usernameInput = page.getByPlaceholder("Логин");
      const passwordInput = page.getByPlaceholder("Пароль");
      const loginButton = page.getByRole("button", { name: /войти/i });

      await usernameInput.fill("admin");
      await passwordInput.fill("admin");
      await loginButton.click();

      await expect(page).toHaveURL(/\/workspaces/, { timeout: 10000 });
    });

    await test.step("Переход на страницу биллинга", async () => {
      await page.goto("http://localhost:5000/admin/billing");
      await page.waitForLoadState("networkidle");
      await expect(page.getByText("Биллинг")).toBeVisible();
    });

    await test.step("Открытие редактирования тарифа Enterprise", async () => {
      const editButton = page.getByRole("button", { name: /редактировать/i }).first();
      await editButton.click();
      await expect(page.getByText("Лимиты тарифа")).toBeVisible();
    });

    await test.step("Изменение кредитов на 100000", async () => {
      const creditsInput = page.locator('input[type="text"][inputmode="decimal"]').first();
      await creditsInput.clear();
      await creditsInput.fill("100000");
    });

    await test.step("Включение no-code toggle", async () => {
      const noCodeSwitch = page.locator('[data-testid="tariff-no-code-switch"]');
      const isChecked = await noCodeSwitch.getAttribute("data-state");
      console.log("[TEST] noCodeSwitch initial state:", isChecked);
      
      if (isChecked !== "checked") {
        await noCodeSwitch.click();
        await expect(noCodeSwitch).toHaveAttribute("data-state", "checked");
      }
    });

    await test.step("Сохранение изменений", async () => {
      const saveButton = page.getByRole("button", { name: /сохранить/i });
      await saveButton.click();
      
      // Ждем завершения запроса
      await page.waitForResponse(
        (response) => response.url().includes("/api/admin/tariffs/") && response.request().method() === "PUT",
        { timeout: 10000 }
      );
      
      // Ждем закрытия модального окна
      await expect(page.getByText("Лимиты тарифа")).not.toBeVisible({ timeout: 5000 });
    });

    await test.step("Проверка логов", async () => {
      console.log("\n=== CONSOLE LOGS ===");
      consoleMessages.forEach((msg) => console.log(msg));

      console.log("\n=== NETWORK REQUESTS ===");
      networkRequests.forEach((req) => {
        console.log(`${req.method} ${req.url}`, req.postData ? JSON.stringify(req.postData) : "");
      });

      console.log("\n=== NETWORK RESPONSES ===");
      networkResponses.forEach((res) => {
        console.log(`${res.status} ${res.url}`, res.body ? JSON.stringify(res.body) : "");
      });

      // Проверяем что нет ошибок в консоли
      const errors = consoleMessages.filter((msg) => msg.includes("[error]"));
      if (errors.length > 0) {
        console.error("Found console errors:", errors);
      }

      // Ищем PUT запрос к /api/admin/tariffs/:id
      const putRequest = networkRequests.find(
        (req) => req.method === "PUT" && req.url.includes("/api/admin/tariffs/")
      );
      expect(putRequest).toBeDefined();
      console.log("\n=== PUT REQUEST PAYLOAD ===");
      console.log(JSON.stringify(putRequest?.postData, null, 2));

      // Проверяем что в payload есть includedCreditsAmount и noCodeFlowEnabled
      expect(putRequest?.postData).toHaveProperty("includedCreditsAmount");
      expect(putRequest?.postData).toHaveProperty("noCodeFlowEnabled");
      
      // Проверяем что includedCreditsAmount это число в центах (100000 кредитов = 10000000 центов)
      console.log("\n=== VALIDATION ===");
      console.log("includedCreditsAmount:", putRequest?.postData?.includedCreditsAmount);
      console.log("noCodeFlowEnabled:", putRequest?.postData?.noCodeFlowEnabled);
      
      expect(putRequest?.postData?.includedCreditsAmount).toBe(10000000); // 100000 кредитов = 10000000 центов
      expect(putRequest?.postData?.noCodeFlowEnabled).toBe(true);
    });

    await test.step("Повторное открытие тарифа для проверки сохранения", async () => {
      const editButton = page.getByRole("button", { name: /редактировать/i }).first();
      await editButton.click();
      await expect(page.getByText("Лимиты тарифа")).toBeVisible();
      
      // Проверяем что значение кредитов сохранилось
      const creditsInput = page.locator('input[type="text"][inputmode="decimal"]').first();
      const savedValue = await creditsInput.inputValue();
      console.log("\n=== SAVED VALUE ===");
      console.log("creditsInput value:", savedValue);
      expect(savedValue).toBe("100000.00");
      
      // Проверяем что no-code toggle включен
      const noCodeSwitch = page.locator('[data-testid="tariff-no-code-switch"]');
      const isChecked = await noCodeSwitch.getAttribute("data-state");
      console.log("noCodeSwitch state:", isChecked);
      expect(isChecked).toBe("checked");
    });
  });
});
