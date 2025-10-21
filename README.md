# @sjalq/trello-mcp-lite

> Minimal Trello MCP server with multi-account support and intelligent API passthrough

A lightweight, pure functional MCP server for Trello that supports multiple accounts and provides direct API access with smart aggregation capabilities.

## Features

- 🔄 **Multi-Account Support** - Manage multiple Trello accounts simultaneously
- 🎯 **Direct API Passthrough** - Full access to Trello REST API v1
- 🧠 **Intelligent Aggregation** - Automatically queries all accounts for read operations
- 💾 **Persistent Storage** - Securely stores credentials locally
- ⚡ **Pure Functional** - Immutable operations, robust error handling
- 🪶 **Lightweight** - Single file, minimal dependencies
- ✅ **Well Tested** - Property-based and integration tests

## Installation

One-line install via Claude MCP CLI:

```bash
npx @sjalq/trello-mcp-lite
```

Or add to your MCP settings:

```json
{
  "mcpServers": {
    "trello": {
      "command": "npx",
      "args": ["@sjalq/trello-mcp-lite"]
    }
  }
}
```

## Quick Start

### 1. Get Your Trello Credentials

- **API Key**: Visit https://trello.com/app-key
- **Token**: Click the "Token" link on that same page to authorize

### 2. Add Your Account

```javascript
// Using the manage_tokens tool
{
  "operation": "add",
  "name": "personal",
  "apiKey": "your_api_key_here",
  "token": "your_token_here"
}
```

### 3. Start Using Trello

```javascript
// List all boards (aggregates across all accounts)
{
  "endpoint": "/members/me/boards",
  "method": "GET"
}

// Create a card on specific account
{
  "endpoint": "/cards",
  "method": "POST",
  "account": "personal",
  "body": {
    "name": "My New Task",
    "idList": "list_id_here",
    "desc": "Task description"
  }
}
```

## Tools

### 1. `trello_api` - Main API Passthrough

Direct access to Trello REST API v1 with multi-account support.

**Parameters:**
- `endpoint` (required): API endpoint (e.g., `/boards/{id}/lists`)
- `method` (required): HTTP method (`GET`, `POST`, `PUT`, `DELETE`)
- `account` (optional): Specific account name. Omit to aggregate all accounts for read operations
- `query` (optional): Query parameters object
- `body` (optional): Request body for POST/PUT/DELETE

**Common Operations:**

```javascript
// 📋 List all boards (across all accounts)
{ "endpoint": "/members/me/boards", "method": "GET" }

// 📑 Get lists on a board
{ "endpoint": "/boards/{boardId}/lists", "method": "GET", "account": "work" }

// 📝 List cards in a list
{ "endpoint": "/lists/{listId}/cards", "method": "GET" }

// ➕ Create a card
{
  "endpoint": "/cards",
  "method": "POST",
  "account": "personal",
  "body": {
    "name": "Task name",
    "idList": "list_id",
    "desc": "Description",
    "due": "2025-12-31"
  }
}

// ✏️ Update a card
{
  "endpoint": "/cards/{cardId}",
  "method": "PUT",
  "body": { "name": "Updated name" }
}

// 📌 Move card to different list
{
  "endpoint": "/cards/{cardId}",
  "method": "PUT",
  "body": { "idList": "new_list_id" }
}

// ✅ Complete/archive a card
{
  "endpoint": "/cards/{cardId}",
  "method": "PUT",
  "body": { "closed": true }
}

// 💬 Add comment to card
{
  "endpoint": "/cards/{cardId}/actions/comments",
  "method": "POST",
  "query": { "text": "My comment" }
}

// 🏷️ Add label to card
{
  "endpoint": "/cards/{cardId}/idLabels",
  "method": "POST",
  "body": { "value": "label_id" }
}
```

**Response Format:**
```javascript
{
  "status": 200,
  "ok": true,
  "data": { /* Trello API response */ }
}
```

**Multi-Account Aggregation:**
When you omit the `account` parameter on aggregatable read operations (like `/members/me/boards`), the tool automatically queries all configured accounts:

```javascript
{
  "status": 207,
  "ok": true,
  "data": {
    "personal": [{ "id": "abc", "name": "Personal Board" }],
    "work": [{ "id": "xyz", "name": "Work Board" }],
    "client": [{ "id": "def", "name": "Client Board" }]
  }
}
```

### 2. `manage_tokens` - Account Management

Manage your Trello account credentials.

**Add Account:**
```javascript
{
  "operation": "add",
  "name": "work",
  "apiKey": "your_api_key",
  "token": "your_token"
}
```

**Remove Account:**
```javascript
{
  "operation": "remove",
  "name": "work"
}
```

**List Accounts:**
```javascript
{
  "operation": "list"
}
```

## Multi-Account Workflow

### Example: Managing Personal and Work Trello

```javascript
// 1. Add both accounts
manage_tokens({ operation: "add", name: "personal", apiKey: "...", token: "..." })
manage_tokens({ operation: "add", name: "work", apiKey: "...", token: "..." })

// 2. List all boards from both accounts
trello_api({ endpoint: "/members/me/boards", method: "GET" })
// Returns: { personal: [...], work: [...] }

// 3. Create card on work account
trello_api({
  endpoint: "/cards",
  method: "POST",
  account: "work",
  body: { name: "Work task", idList: "list123" }
})

// 4. Create card on personal account
trello_api({
  endpoint: "/cards",
  method: "POST",
  account: "personal",
  body: { name: "Personal task", idList: "list456" }
})
```

## Storage

Credentials are stored securely in:
```
~/.trello-mcp-lite/tokens.json
```

Format:
```json
{
  "personal": {
    "apiKey": "...",
    "token": "..."
  },
  "work": {
    "apiKey": "...",
    "token": "..."
  }
}
```

## API Reference

Full Trello REST API documentation: https://developer.trello.com/reference

**Most Common Endpoints:**
- `/members/me/boards` - List user's boards
- `/boards/{id}/lists` - Get lists on a board
- `/lists/{id}/cards` - Get cards in a list
- `/cards` - Create a new card
- `/cards/{id}` - Update/delete a card
- `/cards/{id}/actions/comments` - Add comment

## Development

```bash
# Clone the repo
git clone https://github.com/sjalq/trello-mcp-lite.git
cd trello-mcp-lite

# Install dependencies
npm install

# Run tests
npm test
```

## Architecture

- **Pure Functional**: All operations are immutable transformations
- **Error Handling**: Graceful degradation with detailed error messages
- **Logging**: Minimal stderr logging for debugging
- **No State Mutations**: Read → Transform → Write pattern

## Testing

Includes comprehensive test suite:
- Property-based tests (using fast-check)
- Integration tests
- Unit tests

```bash
npm test
```

## License

ISC

## Author

sjalq

## Contributing

Issues and PRs welcome at https://github.com/sjalq/trello-mcp-lite
