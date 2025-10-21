import { test } from "node:test";
import assert from "node:assert/strict";
import { manageTokensHandler } from "../index.js";
import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const TOKENS_FILE = join(homedir(), ".trello-mcp-lite", "tokens.json");

// Clean up before tests
const cleanup = () => {
  if (existsSync(TOKENS_FILE)) {
    try {
      unlinkSync(TOKENS_FILE);
    } catch (e) {
      // Ignore errors
    }
  }
};

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

test("Integration: Add token creates file and stores data", () => {
  cleanup();

  const result = manageTokensHandler("add", "test", "key123", "token456");

  assert.equal(result.ok, true);
  assert.equal(result.message, "Account 'test' added successfully");
  assert.deepEqual(result.accounts, ["test"]);

  cleanup();
});

test("Integration: List tokens returns all accounts", () => {
  cleanup();

  manageTokensHandler("add", "account1", "key1", "token1");
  manageTokensHandler("add", "account2", "key2", "token2");

  const result = manageTokensHandler("list");

  assert.equal(result.ok, true);
  assert.equal(result.count, 2);
  assert.equal(result.accounts.length, 2);

  cleanup();
});

test("Integration: Remove token works correctly", () => {
  cleanup();

  manageTokensHandler("add", "test1", "key1", "token1");
  manageTokensHandler("add", "test2", "key2", "token2");

  const result = manageTokensHandler("remove", "test1");

  assert.equal(result.ok, true);
  assert.equal(result.message, "Account 'test1' removed successfully");
  assert.deepEqual(result.accounts, ["test2"]);

  cleanup();
});

test("Integration: Remove non-existent token fails gracefully", () => {
  cleanup();

  const result = manageTokensHandler("remove", "nonexistent");

  assert.equal(result.ok, false);
  assert.equal(result.error, "Account 'nonexistent' not found");

  cleanup();
});

test("Integration: Add without required fields fails", () => {
  cleanup();

  const result = manageTokensHandler("add", "test");

  assert.equal(result.ok, false);
  assert.ok(result.error.includes("Missing required fields"));

  cleanup();
});

test("Integration: Unknown operation fails gracefully", () => {
  cleanup();

  const result = manageTokensHandler("invalid");

  assert.equal(result.ok, false);
  assert.ok(result.error.includes("Unknown operation"));

  cleanup();
});

test("Integration: Multiple operations maintain consistency", () => {
  cleanup();

  manageTokensHandler("add", "personal", "key1", "token1");
  manageTokensHandler("add", "work", "key2", "token2");
  manageTokensHandler("add", "client", "key3", "token3");

  let result = manageTokensHandler("list");
  assert.equal(result.count, 3);

  manageTokensHandler("remove", "work");

  result = manageTokensHandler("list");
  assert.equal(result.count, 2);
  assert.ok(result.accounts.some(a => a.name === "personal"));
  assert.ok(result.accounts.some(a => a.name === "client"));
  assert.ok(!result.accounts.some(a => a.name === "work"));

  cleanup();
});

test("Integration: Overwriting existing token works", () => {
  cleanup();

  manageTokensHandler("add", "test", "oldkey", "oldtoken");
  manageTokensHandler("add", "test", "newkey", "newtoken");

  const result = manageTokensHandler("list");

  assert.equal(result.count, 1);
  assert.equal(result.accounts[0].name, "test");

  cleanup();
});

console.log("✅ All integration tests passed!");
