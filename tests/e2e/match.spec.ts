import { expect, test, type Browser, type Page } from "@playwright/test";

async function newPlayer(browser: Browser) {
  const ctx = await browser.newContext();
  return ctx.newPage();
}

async function joinByLink(page: Page, code: string, name: string) {
  await page.goto(`/room/${code}`);
  await page.getByTestId("gate-name").fill(name);
  await page.getByTestId("gate-join").click();
  await expect(page.getByTestId("member-list")).toContainText(name);
}

test("three players create, join, play a full match and see results; spectators see only public state", async ({ browser }) => {
  const host = await newPlayer(browser);
  await host.goto("/");
  await host.getByTestId("name-input").fill("Alex");
  await host.getByTestId("create-room").click();
  await host.waitForURL(/\/room\/[A-Z]{4}$/);
  const code = (await host.getByTestId("room-code").textContent())!.trim();
  expect(code).toMatch(/^[A-Z]{4}$/);

  // Start is blocked with fewer than three players.
  await expect(host.getByTestId("start")).toBeDisabled();

  const ben = await newPlayer(browser);
  await joinByLink(ben, code, "Ben");
  const chris = await newPlayer(browser);
  // Joining from the home page with a code works too.
  await chris.goto("/");
  await chris.getByTestId("name-input").fill("Chris");
  await chris.getByTestId("code-input").fill(code);
  await chris.getByTestId("join-room").click();
  await chris.waitForURL(new RegExp(`/room/${code}$`));

  await expect(host.getByTestId("member-list")).toContainText("Chris");
  // Non-hosts cannot change settings.
  await expect(ben.getByRole("radio", { name: "Quick" })).toBeDisabled();
  await host.getByRole("radio", { name: "Quick" }).click();

  const spectator = await newPlayer(browser);
  await spectator.goto(`/room/${code}/spectate`);
  await expect(spectator.getByText("The show hasn't started")).toBeVisible();

  for (const p of [host, ben, chris]) await p.getByTestId("ready").click();
  await expect(host.getByTestId("start")).toBeEnabled();
  await host.getByTestId("start").click();

  // Every player locks an answer in the first submission window.
  for (const p of [host, ben, chris]) {
    await expect(p.locator('[data-phase="CALIBRATION_SUBMISSION"]')).toBeVisible({ timeout: 20_000 });
  }
  for (const p of [host, ben, chris]) await p.getByTestId("lock").click();
  // The phase ends early once everyone has locked.
  await expect(host.locator('[data-phase="CALIBRATION_PREDICTION"]')).toBeVisible({ timeout: 10_000 });

  // The host has host controls; others do not.
  await expect(host.getByTestId("host-controls")).toBeVisible();
  await expect(ben.getByTestId("host-controls")).toHaveCount(0);
  // Spectators see the stage but never private controls.
  await expect(spectator.getByTestId("phase-label")).toBeVisible();
  await expect(spectator.getByTestId("action-dock")).toHaveCount(0);

  // Let the remaining phases time out to the end.
  for (const p of [host, ben, chris]) await expect(p.getByTestId("results")).toBeVisible({ timeout: 360_000 });
  await expect(host.getByTestId("winner")).toBeVisible();
  await expect(spectator.getByTestId("results")).toBeVisible();

  // Back to the lobby with the same room.
  await host.getByTestId("back-to-lobby").click();
  await expect(host.getByTestId("member-list")).toBeVisible();
  await expect(ben.getByTestId("member-list")).toBeVisible();
});
