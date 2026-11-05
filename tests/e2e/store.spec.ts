import { expect, test } from "@playwright/test";

test("a host buys a pack with mock payment, then enables it and its 18+ switch only affects consenting rooms", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  await page.goto("/account");
  await page.getByTestId("tab-register").click();
  await page.getByTestId("email-register").fill(email);
  await page.getByTestId("password-register").fill("correct-horse-battery");
  await page.getByTestId("submit-register").click();
  await expect(page.getByTestId("signed-in-as")).toContainText(email);

  await page.goto("/store");
  await expect(page.getByTestId("product-pack-dating")).toContainText("₹149");
  await page.getByTestId("product-pack-dating").click();
  await expect(page.getByTestId("product-name")).toHaveText(/Dating/i);
  await page.getByTestId("buy").click();
  await page.getByTestId("mock-pay").click();
  await expect(page.getByText("You own this")).toBeVisible();

  await page.goto("/library");
  await expect(page.getByTestId("owned-packs")).toContainText("Dating");

  // Host a room: the purchased pack is available to the room, NSFW is off by default.
  await page.goto("/");
  await page.getByTestId("name-input").fill("Host");
  await page.getByTestId("create-room").click();
  await page.waitForURL(/\/room\/[A-Z]{4}$/);
  const toggle = page.getByTestId("pack-toggle-dating");
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(toggle).toHaveAttribute("data-state", "checked");
  const nsfw = page.getByTestId("nsfw-dating");
  await expect(nsfw).toHaveAttribute("data-state", "unchecked");
  await nsfw.click();
  await expect(page.getByTestId("adult-status")).toContainText("off until everyone opts in");

  // Opting in (with age confirmation) as the only player activates it.
  await page.getByTestId("content-prefs").click();
  await page.getByTestId("consent-adult").click();
  await page.getByTestId("consent-age").check();
  await page.getByTestId("consent-save").click();
  await expect(page.getByTestId("adult-status")).toContainText("Adult prompts are active");

  // An unowned pack cannot be toggled on.
  await expect(page.getByTestId("pack-toggle-anime-gaming")).toHaveCount(0);
});
