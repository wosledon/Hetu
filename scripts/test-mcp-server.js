#!/usr/bin/env node

const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

function send(message) {
  console.log(JSON.stringify(message));
}

rl.on('line', (line) => {
  try {
    const request = JSON.parse(line);

    if (request.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          serverInfo: { name: 'test-server', version: '1.0.0' }
        }
      });
    } else if (request.method === 'notifications/initialized') {
      // no response
    } else if (request.method === 'tools/list') {
      send({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          tools: [
            {
              name: 'echo',
              description: 'Echo the input text',
              inputSchema: {
                type: 'object',
                properties: {
                  text: { type: 'string' }
                },
                required: ['text']
              }
            }
          ]
        }
      });
    } else if (request.method === 'tools/call') {
      const args = request.params.arguments || {};
      send({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [
            { type: 'text', text: `Echo: ${args.text || ''}` }
          ]
        }
      });
    } else {
      send({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: 'Method not found' }
      });
    }
  } catch (err) {
    // ignore invalid JSON
  }
});
