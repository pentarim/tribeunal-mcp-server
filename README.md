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

### Running the Server

```bash
# Development mode with hot reload
npm run dev

# Build and run production
npm run build
npm start
```

### Connecting with MCP Client

The server supports both stdio and HTTP transports:

```javascript
// Example client connection
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const client = new Client({
  name: 'my-tribeunal-client',
  version: '1.0.0'
});

// Connect via stdio
await client.connect({
  transport: 'stdio',
  command: 'node',
  args: ['path/to/tribeunal-mcp-server']
});
```

## Available Tools

### Core Decision Tools

- `decision_find_active` - Find active decisions requiring input
- `decision_get_status` - Check decision status and progress
- `decision_start_process` - Start a structured decision-making process
- `decision_choose_option` - Express your choice with optional reasoning
- `decision_check_consensus` - Monitor consensus and participation levels
- `decision_gather_evidence` - Collect supporting information and arguments
- `decision_provide_info` - Submit evidence or supporting data

### Decision Templates

- **Business Choice**: ROI, timeline, resource decisions
- **Technical Decision**: Architecture, tool selection, implementation choices
- **Policy Vote**: Rule changes, guideline establishment
- **Priority Ranking**: Feature prioritization, task ordering
- **Emergency Decision**: Fast-track decisions with escalation rules

### Community Tools

- `tribeunal_list_tribes` - Browse expert communities
- `tribeunal_get_tribe` - Get community details and expertise areas
- `tribeunal_join_tribe` - Join specialized decision-making communities

## Development

```bash
# Run tests
npm test

# Lint code
npm run lint

# Format code
npm run format
```

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