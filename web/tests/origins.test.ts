import assert from "node:assert/strict";
import test from "node:test";
import { permittedOrigins } from "../src/lib/origins";

test("preview Vercel : seule l'origine exacte est autorisée", () => {
  const origins = permittedOrigins({ NODE_ENV: "production", VERCEL: "1", VERCEL_URL: "test-123.vercel.app" });
  assert.ok(origins.has("https://test-123.vercel.app"));
  assert.ok(!origins.has("https://autre.vercel.app"));
  assert.ok(!origins.has("http://localhost:3000"));
});
test("domaine personnalisé et environnement local", () => {
  assert.ok(permittedOrigins({ NODE_ENV: "production", APP_ORIGIN: "https://exemple.be/" }).has("https://exemple.be"));
  assert.equal(permittedOrigins({ NODE_ENV: "production", VERCEL_URL: "test.vercel.app" }).size, 0);
  assert.ok(permittedOrigins({ NODE_ENV: "development" }).has("http://localhost:3000"));
});
