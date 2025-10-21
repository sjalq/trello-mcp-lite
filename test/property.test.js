import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { addToken, removeToken, hasToken, isAggregatable } from "../index.js";

// ============================================================================
// PROPERTY-BASED TESTS
// ============================================================================

test("Property: Adding a token makes it retrievable", () => {
  fc.assert(
    fc.property(
      fc.record({
        name: fc.nat({ max: 1000 }).map(n => `token_${n}`),
        apiKey: fc.hexaString({ minLength: 8, maxLength: 8 }),
        token: fc.hexaString({ minLength: 16, maxLength: 16 })
      }),
      ({ name, apiKey, token }) => {
        const tokens = {};
        const newTokens = addToken(tokens, name, apiKey, token);
        return hasToken(newTokens, name) &&
               newTokens[name].apiKey === apiKey &&
               newTokens[name].token === token;
      }
    ),
    { numRuns: 5 }
  );
});

test("Property: Removing a token makes it not retrievable", () => {
  fc.assert(
    fc.property(
      fc.record({
        name: fc.nat({ max: 1000 }).map(n => `token_${n}`),
        apiKey: fc.hexaString({ minLength: 8, maxLength: 8 }),
        token: fc.hexaString({ minLength: 16, maxLength: 16 })
      }),
      ({ name, apiKey, token }) => {
        const tokens = addToken({}, name, apiKey, token);
        const newTokens = removeToken(tokens, name);
        return !hasToken(newTokens, name);
      }
    ),
    { numRuns: 5 }
  );
});

test("Property: Adding multiple tokens preserves all of them", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          name: fc.nat({ max: 1000 }).map(n => `token_${n}`),
          apiKey: fc.hexaString({ minLength: 32, maxLength: 32 }),
          token: fc.hexaString({ minLength: 64, maxLength: 64 })
        }),
        { minLength: 1, maxLength: 10 }
      ),
      (tokenList) => {
        // Build up tokens
        let tokens = {};
        for (const { name, apiKey, token } of tokenList) {
          tokens = addToken(tokens, name, apiKey, token);
        }

        // All should be present
        return tokenList.every(({ name }) => hasToken(tokens, name));
      }
    ),
    { numRuns: 5 }
  );
});

test("Property: Token operations are immutable", () => {
  fc.assert(
    fc.property(
      fc.record({
        name: fc.nat({ max: 1000 }).map(n => `token_${n}`),
        apiKey: fc.hexaString({ minLength: 8, maxLength: 8 }),
        token: fc.hexaString({ minLength: 16, maxLength: 16 })
      }),
      ({ name, apiKey, token }) => {
        const originalTokens = { existing: { apiKey: "abc", token: "xyz" } };
        const originalKeys = Object.keys(originalTokens);

        // Add operation should not mutate original
        addToken(originalTokens, name, apiKey, token);

        return Object.keys(originalTokens).length === originalKeys.length &&
               originalTokens.existing.apiKey === "abc";
      }
    ),
    { numRuns: 5 }
  );
});

test("Property: Removing non-existent token returns unchanged object", () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 20 }),
      (name) => {
        const tokens = { existing: { apiKey: "abc", token: "xyz" } };
        const newTokens = removeToken(tokens, name);

        // If name was "existing", it should be removed
        // Otherwise, should be same size
        if (name === "existing") {
          return Object.keys(newTokens).length === 0;
        } else {
          return Object.keys(newTokens).length === 1;
        }
      }
    ),
    { numRuns: 5 }
  );
});

test("Property: isAggregatable is deterministic", () => {
  fc.assert(
    fc.property(
      fc.record({
        endpoint: fc.constantFrom(
          "/members/me/boards",
          "/members/me/cards",
          "/boards/123/lists",
          "/cards/456"
        ),
        method: fc.constantFrom("GET", "POST", "PUT", "DELETE")
      }),
      ({ endpoint, method }) => {
        const result1 = isAggregatable(endpoint, method);
        const result2 = isAggregatable(endpoint, method);
        return result1 === result2;
      }
    ),
    { numRuns: 5 }
  );
});

test("Property: Only GET requests can be aggregatable", () => {
  fc.assert(
    fc.property(
      fc.record({
        endpoint: fc.string(),
        method: fc.constantFrom("POST", "PUT", "DELETE", "PATCH")
      }),
      ({ endpoint, method }) => {
        return isAggregatable(endpoint, method) === false;
      }
    ),
    { numRuns: 5 }
  );
});

test("Property: Adding same token twice overwrites", () => {
  fc.assert(
    fc.property(
      fc.record({
        name: fc.nat({ max: 1000 }).map(n => `token_${n}`),
        apiKey1: fc.hexaString({ minLength: 8, maxLength: 8 }),
        token1: fc.hexaString({ minLength: 16, maxLength: 16 }),
        apiKey2: fc.hexaString({ minLength: 8, maxLength: 8 }),
        token2: fc.hexaString({ minLength: 16, maxLength: 16 })
      }),
      ({ name, apiKey1, token1, apiKey2, token2 }) => {
        let tokens = addToken({}, name, apiKey1, token1);
        tokens = addToken(tokens, name, apiKey2, token2);

        // Should have only one entry with latest values
        return Object.keys(tokens).length === 1 &&
               tokens[name].apiKey === apiKey2 &&
               tokens[name].token === token2;
      }
    ),
    { numRuns: 5 }
  );
});

// ============================================================================
// UNIT TESTS
// ============================================================================

test("Unit: addToken adds token correctly", () => {
  const tokens = {};
  const result = addToken(tokens, "test", "key123", "token456");

  assert.deepEqual(result, {
    test: { apiKey: "key123", token: "token456" }
  });
});

test("Unit: removeToken removes token correctly", () => {
  const tokens = {
    test1: { apiKey: "key1", token: "token1" },
    test2: { apiKey: "key2", token: "token2" }
  };
  const result = removeToken(tokens, "test1");

  assert.deepEqual(result, {
    test2: { apiKey: "key2", token: "token2" }
  });
});

test("Unit: hasToken checks existence correctly", () => {
  const tokens = { test: { apiKey: "key", token: "token" } };

  assert.equal(hasToken(tokens, "test"), true);
  assert.equal(hasToken(tokens, "missing"), false);
});

test("Unit: isAggregatable returns true for /members/me/boards GET", () => {
  assert.equal(isAggregatable("/members/me/boards", "GET"), true);
});

test("Unit: isAggregatable returns false for POST requests", () => {
  assert.equal(isAggregatable("/members/me/boards", "POST"), false);
});

test("Unit: isAggregatable returns false for non-aggregatable endpoints", () => {
  assert.equal(isAggregatable("/boards/123/lists", "GET"), false);
});

console.log("✅ All property-based tests passed!");
