#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import dotenv from 'dotenv';
import { setupTools } from './server.js';

// Load environment variables
dotenv.config();

// Create and configure the MCP server
const server = new Server(
  {
    name: 'tribeunal-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Set up all tools
setupTools(server);

// Error handling
server.onerror = (error) => {
  console.error('[MCP Server Error]', error);
};

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Tribeunal MCP Server started successfully');
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});