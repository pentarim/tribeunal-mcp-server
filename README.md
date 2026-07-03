# Decision-Making MCP Server

A Model Context Protocol (MCP) server that provides programmatic access to community-driven decision-making processes, consensus building, and collaborative choice resolution.

## Features

- 🎯 **Decision Processes**: Start, monitor, and participate in structured decisions
- 🤝 **Consensus Building**: Track agreement levels and participation across communities
- 🧠 **Smart Analysis**: Get insights on decision readiness, bias detection, and outcome prediction
- 📊 **Real-time Tracking**: Monitor decision progress with live participation metrics
- 👥 **Stakeholder Management**: Invite specific participants and manage decision access
- 🔐 **Secure Access**: Token-based authentication with rate limiting

## Installation

```bash
# Clone the repository
git clone https://github.com/pentarim/tribeunal-mcp-server.git
cd tribeunal-mcp-server

# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Configure your API credentials in .env
```

## Configuration

Edit the `.env` file with your Tribeunal API credentials:

```env
TRIBEUNAL_API_BASE_URL=https://tribeunal.test/api
TRIBEUNAL_API_KEY=your_api_key_here
```

## Usage

### Option 1: Stdio Server (Local)

```bash
# Development mode with hot reload
npm run dev

# Build and run production
npm run build
npm start
```

#### Connecting with MCP Client

```javascript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const client = new Client({
  name: 'my-tribeunal-client',
  version: '1.0.0'
});

await client.connect({
  transport: 'stdio',
  command: 'node',
  args: ['path/to/tribeunal-mcp-server']
});
```

### Option 2: Remote MCP Server on Cloudflare (Auth0-authenticated)

The `worker/` directory hosts a **remote** MCP server on Cloudflare Workers that
authenticates each caller via **Auth0** and runs every tool call **as that user**
(not a shared key). It exposes the same tools as the stdio server — they share a
transport-agnostic core (`src/core/tools.ts`, `src/client/api-client.ts`).

Full setup, deploy steps, Auth0 app requirements, and the required secrets are in
**[`worker/README.md`](./worker/README.md)**. The authoritative Auth0 contract
(audience, scopes, env-var names, callback URLs, token shape) lives in the app
repo at `app/docs/AUTH0_CONTRACT.md`.

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars   # fill in Auth0 values; see worker/README.md
npx wrangler types               # regenerate Cloudflare runtime types
npx wrangler deploy --dry-run --outdir /tmp/wkr   # validate without deploying
```

#### MCP Client Configuration (mcp-remote bridge)

Add to your `.mcp.json` or Claude Desktop config:

```json
{
  "mcpServers": {
    "tribeunal": {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp.tribeunal.com/sse"]
    }
  }
}
```

## Available Tools

### Case Tools

- `tribeunal_create_case` - Create a case for community decision-making
- `tribeunal_search_cases` - Find cases by query, status, type, or tags
- `tribeunal_get_case` - Get detailed case information (sides, comments, activity)
- `tribeunal_list_evidence` - List a case's marked evidence (comments + case files)

### Voting Tools

- `tribeunal_cast_vote` - Vote for a side, optionally with a short comment (shown in the activity feed)
- `tribeunal_revoke_vote` - Revoke a previously cast vote
- `tribeunal_get_vote_stats` - Real-time voting statistics

### Comment & Evidence Tools

Evidence is marked, not submitted: post comments, then the case owner or jury
marks a comment or case file as evidence.

- `tribeunal_post_comment` - Post a comment (your analysis/perspective) on a case
- `tribeunal_list_comments` - List a case's comments
- `tribeunal_mark_evidence` - Mark another user's comment or a case file as evidence (owner/jury only)
- `tribeunal_unmark_evidence` - Remove an evidence mark (owner/jury only)
- `tribeunal_rate_evidence` - Rate case-file evidence (1 up / 0 irrelevant / -1 down)

### Community Tools

- `tribeunal_list_tribes` / `tribeunal_get_tribe` / `tribeunal_join_tribe` / `tribeunal_leave_tribe` / `tribeunal_create_tribe`

### User & Jury Duty Tools

- `tribeunal_get_user` / `tribeunal_get_current_user`
- `tribeunal_jury_duty_status` / `_allowance` / `_dashboard` / `_start` / `_cancel` / `_accept` / `_reject` / `_history`

## Development

```bash
# Run tests
npm test

# Lint code
npm run lint

# Format code
npm run format
```

## Example Usage

### Basic Decision Making
```
User: "I need to decide between React and Vue for my new project"
AI: Uses tribeunal_create_case with two sides, shares the case URL, later tribeunal_get_vote_stats to read the community's verdict
```

### Contributing Analysis
```
User: "Weigh in on this open case about EV purchase timing"
AI: Uses tribeunal_get_case to review sides and comments, tribeunal_post_comment with its analysis, then tribeunal_cast_vote with a short comment explaining the reasoning
```

### Curating Evidence (case owner or jury)
```
User: "Mark the strongest comment on my case as evidence"
AI: Uses tribeunal_list_comments to find it, then tribeunal_mark_evidence {kind: "comment", id} — it now appears in the case's evidence list
```

### Community Engagement
```
User: "Find experts in machine learning to help with my AI project decision"
AI: Uses tribeunal_list_tribes to find ML communities, tribeunal_get_tribe for expertise details, tribeunal_join_tribe to connect with experts
```

## Related Projects

**Main Tribeunal Platform**: [pentarim/tribeunal](https://github.com/pentarim/tribeunal) - The core web application and API that this MCP server connects to.

## API Documentation

For detailed API documentation, see the [docs](./docs) directory.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

- Documentation: [https://github.com/pentarim/tribeunal-mcp-server/wiki](https://github.com/pentarim/tribeunal-mcp-server/wiki)
- Issues: [https://github.com/pentarim/tribeunal-mcp-server/issues](https://github.com/pentarim/tribeunal-mcp-server/issues)
- Tribeunal Platform: [https://tribeunal.com](https://tribeunal.com)