import { expect, test } from "@playwright/test";

test("question, source officielle, relance et nouveau chat", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Vos questions");
  await page.getByRole("button", { name: /Mobilité/ }).click();
  await expect(page.getByText("Sources utilisées")).toBeVisible();
  await expect(page.locator(".answer blockquote").first()).toContainText(/STIB|bus|métro/);
  await expect(page.locator(".answer-footer").first()).toContainText(/Réponse en \d+,\d s/);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter la réponse" }).first().click();
  expect((await download).suggestedFilename()).toMatch(/^reponse-parlement-\d{4}-\d{2}-\d{2}-\d{4}\.html$/);
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
test("/api/health : corpus, dernière date et version du schéma attendue", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  const health = await response.json();
  expect(health.status).toBe("ok");
  expect(health.documents).toBeGreaterThan(0);
  expect(health.latestDocument).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  // Local recette: no Supabase, so no vector search and no schema to read.
  expect(health.semantic).toBe(false);
  expect(health.schema).toBeNull();
  expect(health.schemaExpected).toBeGreaterThanOrEqual(10);
});

// A recognition that hears « STIB en cas de chaleur » as soon as it starts, so that the test
// does not depend on a microphone nor on the browser's speech service.
const fakeRecognition = () => {
  class FakeRecognition {
    lang = "";
    continuous = false;
    interimResults = false;
    maxAlternatives = 1;
    onresult: ((event: unknown) => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    onend: (() => void) | null = null;
    start() {
      setTimeout(() => this.onresult?.({ results: [[{ transcript: "STIB en cas de chaleur" }]] }), 30);
    }
    stop() {
      setTimeout(() => this.onend?.(), 0);
    }
    abort() {
      this.onend?.();
    }
  }
  Object.assign(window, { SpeechRecognition: FakeRecognition, webkitSpeechRecognition: FakeRecognition });
};

test("dictée : le micro remplit la question sans l'envoyer", async ({ page }) => {
  await page.addInitScript(fakeRecognition);
  await page.goto("/");
  const mic = page.getByRole("button", { name: "Dicter votre question" });
  await expect(mic).toHaveAttribute("aria-pressed", "false");
  await page.locator("#question").fill("Que fait la");
  await mic.click();
  await expect(mic).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".dictation-status")).toContainText("Je vous écoute");
  await expect(page.locator("#question")).toHaveValue("Que fait la STIB en cas de chaleur");
  await mic.click();
  await expect(mic).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".dictation-status")).toBeEmpty();
  // Nothing was sent: the person reads and corrects first.
  await expect(page.getByText("Sources utilisées")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Envoyer la question" }).click();
  await expect(page.getByText("Sources utilisées")).toBeVisible();
});

test("dictée : pas de bouton micro quand le navigateur ne sait pas dicter", async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { SpeechRecognition: undefined, webkitSpeechRecognition: undefined });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Envoyer la question" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dicter votre question" })).toHaveCount(0);
});
