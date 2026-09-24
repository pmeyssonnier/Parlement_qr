import { test, expect } from "@playwright/test";
test("question, source officielle, relance et nouveau chat", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Vos questions");
  await page.getByRole("button", { name: /Mobilité/ }).click();
  await expect(page.getByText("Sources utilisées")).toBeVisible();
  await expect(page.locator(".answer blockquote").first()).toContainText(/STIB|bus|métro/);
  await page.locator(".source-card summary").first().click();
  await expect(page.getByRole("link", { name: "Lire la fiche officielle" }).first()).toHaveAttribute(
    "href",
    /^https:\/\/www\.parlement\.brussels\//,
  );
  await page.getByLabel("Votre question sur les documents parlementaires").fill("Et dans les trams ?");
  await page.getByRole("button", { name: "Envoyer la question" }).click();
  await expect(page.locator(".answer")).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test("absence de résultat et explication du périmètre", async ({ page }) => {
  await page.goto("/");
  await page
    .getByLabel("Votre question sur les documents parlementaires")
    .fill("Astronautes martiens et fusées interstellaires");
  await page.getByRole("button", { name: "Envoyer la question" }).click();
  await expect(page.getByText(/Je n’ai pas trouvé d’information suffisamment pertinente/)).toBeVisible();
  await page.getByRole("button", { name: "Voir le périmètre" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
test("API rejette les origines tierces et les messages excessifs", async ({ request }) => {
  const denied = await request.post("/api/chat", {
    headers: { origin: "https://evil.example" },
    data: { message: "STIB" },
  });
  expect(denied.status()).toBe(403);
  const long = await request.post("/api/chat", {
    headers: { origin: "http://127.0.0.1:3000" },
    data: { message: "a".repeat(1501) },
  });
  expect(long.status()).toBe(400);
});
