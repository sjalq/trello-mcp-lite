#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf-8"));

const CONFIG_DIR = join(homedir(), ".trello-mcp-lite");
const TOKENS_FILE = join(CONFIG_DIR, "tokens.json");

// ============================================================================
// PURE FUNCTIONAL TOKEN STORAGE
// ============================================================================

const ensureConfigDir = () => {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
};

const readTokens = () => {
  try {
    ensureConfigDir();
    if (!existsSync(TOKENS_FILE)) {
      return {};
    }
    const content = readFileSync(TOKENS_FILE, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error(`[trello-mcp-lite] Error reading tokens: ${error.message}`);
    return {};
  }
};

const writeTokens = (tokens) => {
  try {
    ensureConfigDir();
    writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2), "utf-8");
    console.error(`[trello-mcp-lite] Tokens saved successfully`);
    return { ok: true, tokens };
  } catch (error) {
    console.error(`[trello-mcp-lite] Error writing tokens: ${error.message}`);
    return { ok: false, error: error.message };
  }
};

// Pure functions for token transformations
const addToken = (tokens, name, apiKey, token) => ({
  ...tokens,
  [name]: { apiKey, token }
});

const removeToken = (tokens, name) => {
  const { [name]: removed, ...rest } = tokens;
  return rest;
};

const hasToken = (tokens, name) => name in tokens;

// ============================================================================
// HTTP CLIENT - PURE FUNCTIONAL
// ============================================================================

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const safeResponse = (res) =>
  res.text()
    .then(text => ({
      status: res.status,
      ok: res.ok,
      data: text ? parseJson(text) : null
    }))
    .catch(error => ({
      status: res.status,
      ok: false,
      data: { error: error.message, type: "ResponseParseError" }
    }));

const safeFetch = (url, options) => {
  const timeout = setTimeout(() => {}, 30000);

  return fetch(url, options)
    .then(res => {
      clearTimeout(timeout);
      return safeResponse(res);
    })
    .catch(error => {
      clearTimeout(timeout);
      const type = error.name === "AbortError" ? "TimeoutError" : "NetworkError";
      return { status: 0, ok: false, data: { error: error.message, type } };
    });
};

const buildTrelloUrl = (endpoint, apiKey, token, query = {}) => {
  const url = new URL(`https://api.trello.com/1${endpoint}`);
  url.searchParams.append("key", apiKey);
  url.searchParams.append("token", token);

  Object.entries(query || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) {
      url.searchParams.append(k, String(v));
    }
  });

  return url.toString();
};

const callTrello = (apiKey, token) => (endpoint, method, query, body) => {
  const url = buildTrelloUrl(endpoint, apiKey, token, query);
  const normalizedMethod = method.toUpperCase();
  const hasBody = body && Object.keys(body).length > 0;

  console.error(`[trello-mcp-lite] ${normalizedMethod} ${endpoint}`);

  return safeFetch(url, {
    method: normalizedMethod,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": `trello-mcp-lite/${pkg.version}`
    },
    body: hasBody ? JSON.stringify(body) : undefined
  });
};

// ============================================================================
// MULTI-ACCOUNT AGGREGATION
// ============================================================================

const isAggregatable = (endpoint, method) => {
  // Only aggregate safe read operations
  if (method.toUpperCase() !== "GET") return false;

  // Aggregatable patterns
  const aggregatablePatterns = [
    "/members/me/boards",
    "/members/me/cards",
    "/members/me/organizations",
    "/members/me/notifications"
  ];

  return aggregatablePatterns.some(pattern => endpoint.includes(pattern));
};

const executeMultiAccount = async (tokens, endpoint, method, query, body) => {
  const entries = Object.entries(tokens);

  if (entries.length === 0) {
    return {
      status: 401,
      ok: false,
      data: { error: "No tokens configured. Use manage_tokens tool to add accounts." }
    };
  }

  const results = await Promise.all(
    entries.map(async ([name, creds]) => {
      try {
        const result = await callTrello(creds.apiKey, creds.token)(endpoint, method, query, body);
        return [name, result];
      } catch (error) {
        return [name, { status: 0, ok: false, data: { error: error.message } }];
      }
    })
  );

  const resultObj = Object.fromEntries(results);

  // Check if all failed
  const allFailed = Object.values(resultObj).every(r => !r.ok);
  if (allFailed) {
    return {
      status: 500,
      ok: false,
      data: { error: "All accounts failed", results: resultObj }
    };
  }

  // Multi-status response
  return {
    status: 207,
    ok: true,
    data: resultObj
  };
};

const executeSingleAccount = async (tokens, accountName, endpoint, method, query, body) => {
  if (!tokens[accountName]) {
    return {
      status: 404,
      ok: false,
      data: { error: `Account '${accountName}' not found. Available: ${Object.keys(tokens).join(", ")}` }
    };
  }

  const creds = tokens[accountName];
  return await callTrello(creds.apiKey, creds.token)(endpoint, method, query, body);
};

const executeTrelloRequest = async (endpoint, method, query, body, account) => {
  const tokens = readTokens();

  if (account) {
    // Single account specified
    return await executeSingleAccount(tokens, account, endpoint, method, query, body);
  }

  if (isAggregatable(endpoint, method)) {
    // Multi-account aggregation
    console.error(`[trello-mcp-lite] Aggregating across ${Object.keys(tokens).length} accounts`);
    return await executeMultiAccount(tokens, endpoint, method, query, body);
  }

  // For non-aggregatable requests without account specified, try first available
  const firstAccount = Object.keys(tokens)[0];
  if (!firstAccount) {
    return {
      status: 401,
      ok: false,
      data: { error: "No tokens configured. Use manage_tokens tool to add accounts." }
    };
  }

  console.error(`[trello-mcp-lite] Using first available account: ${firstAccount}`);
  return await executeSingleAccount(tokens, firstAccount, endpoint, method, query, body);
};

// ============================================================================
// TOKEN MANAGEMENT
// ============================================================================

const manageTokensHandler = (operation, name, apiKey, token) => {
  const tokens = readTokens();

  switch (operation) {
    case "add":
      if (!name || !apiKey || !token) {
        return {
          ok: false,
          error: "Missing required fields: name, apiKey, token"
        };
      }
      const newTokens = addToken(tokens, name, apiKey, token);
      const addResult = writeTokens(newTokens);
      return {
        ok: addResult.ok,
        message: addResult.ok
          ? `Account '${name}' added successfully`
          : addResult.error,
        accounts: Object.keys(newTokens)
      };

    case "remove":
      if (!name) {
        return { ok: false, error: "Missing required field: name" };
      }
      if (!hasToken(tokens, name)) {
        return { ok: false, error: `Account '${name}' not found` };
      }
      const removedTokens = removeToken(tokens, name);
      const removeResult = writeTokens(removedTokens);
      return {
        ok: removeResult.ok,
        message: removeResult.ok
          ? `Account '${name}' removed successfully`
          : removeResult.error,
        accounts: Object.keys(removedTokens)
      };

    case "list":
      return {
        ok: true,
        accounts: Object.keys(tokens).map(name => ({ name })),
        count: Object.keys(tokens).length
      };

    default:
      return { ok: false, error: `Unknown operation: ${operation}` };
  }
};

// ============================================================================
// MCP SERVER
// ============================================================================

const createServer = () => {
  const server = new Server(
    { name: "trello-mcp-lite", version: pkg.version },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: "trello_api",
        description: `Multi-account Trello API passthrough with intelligent aggregation.

**AUTHENTICATION**: Use manage_tokens tool first to add your Trello accounts.

**COMMON OPERATIONS** (80/20 rule - most used endpoints):

📋 LIST BOARDS (aggregates all accounts):
   { "endpoint": "/members/me/boards", "method": "GET" }

📝 LIST CARDS IN LIST:
   { "endpoint": "/lists/{listId}/cards", "method": "GET", "account": "work" }

➕ CREATE CARD:
   { "endpoint": "/cards", "method": "POST", "account": "personal",
     "body": { "name": "Task", "idList": "list_id", "desc": "Description" } }

✏️  UPDATE CARD:
   { "endpoint": "/cards/{cardId}", "method": "PUT", "account": "work",
     "body": { "name": "New name", "desc": "New description" } }

📌 MOVE CARD TO LIST:
   { "endpoint": "/cards/{cardId}", "method": "PUT",
     "body": { "idList": "new_list_id" } }

✅ CLOSE CARD:
   { "endpoint": "/cards/{cardId}", "method": "PUT",
     "body": { "closed": true } }

📑 GET LISTS ON BOARD:
   { "endpoint": "/boards/{boardId}/lists", "method": "GET" }

💬 ADD COMMENT:
   { "endpoint": "/cards/{cardId}/actions/comments", "method": "POST",
     "query": { "text": "Comment text" } }

**MULTI-ACCOUNT**: Omit 'account' parameter to query ALL accounts (read operations only).
**RESPONSE**: { status: number, ok: boolean, data: object|array }

Full API docs: https://developer.trello.com/reference`,
        inputSchema: {
          type: "object",
          properties: {
            endpoint: {
              type: "string",
              description: "API endpoint (e.g., /boards/{id}/lists, /cards/{id})"
            },
            method: {
              type: "string",
              enum: ["GET", "POST", "PUT", "DELETE"],
              description: "HTTP method"
            },
            account: {
              type: "string",
              description: "Optional: specific account name. Omit to aggregate all accounts (read operations)"
            },
            query: {
              type: "object",
              description: "Optional: query parameters (e.g., {filter: 'open', fields: 'name,desc'})"
            },
            body: {
              type: "object",
              description: "Optional: request body for POST/PUT/DELETE"
            }
          },
          required: ["endpoint", "method"]
        }
      },
      {
        name: "manage_tokens",
        description: `Manage Trello account credentials (stored in ~/.trello-mcp-lite/tokens.json).

**ADD ACCOUNT**:
   { "operation": "add", "name": "work",
     "apiKey": "your_key", "token": "your_token" }

**REMOVE ACCOUNT**:
   { "operation": "remove", "name": "work" }

**LIST ACCOUNTS**:
   { "operation": "list" }

**GET YOUR CREDENTIALS**:
1. API Key: https://trello.com/app-key
2. Token: Click "Token" link on that same page to authorize

Each account needs its own apiKey and token pair.`,
        inputSchema: {
          type: "object",
          properties: {
            operation: {
              type: "string",
              enum: ["add", "remove", "list"],
              description: "Operation to perform"
            },
            name: {
              type: "string",
              description: "Account name (required for add/remove)"
            },
            apiKey: {
              type: "string",
              description: "Trello API key (required for add)"
            },
            token: {
              type: "string",
              description: "Trello token (required for add)"
            }
          },
          required: ["operation"]
        }
      }
    ]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "trello_api") {
      const { endpoint, method, account, query, body } = args;
      const result = await executeTrelloRequest(endpoint, method, query, body, account);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }

    if (name === "manage_tokens") {
      const { operation, name: accountName, apiKey, token } = args;
      const result = manageTokensHandler(operation, accountName, apiKey, token);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !result.ok
      };
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ error: "Unknown tool", requested: name }, null, 2)
      }],
      isError: true
    };
  });

  return server;
};

// ============================================================================
// MAIN
// ============================================================================

const main = () => {
  console.error(`[trello-mcp-lite] Starting v${pkg.version}`);
  const server = createServer();
  const transport = new StdioServerTransport();
  server.connect(transport).catch((error) => {
    console.error(`[trello-mcp-lite] Fatal error:`, error);
    process.exit(1);
  });
};

main();

// Export for testing
export {
  addToken,
  removeToken,
  hasToken,
  callTrello,
  isAggregatable,
  manageTokensHandler,
  readTokens,
  writeTokens
};
