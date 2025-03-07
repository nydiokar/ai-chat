import express from 'express';
import cors from 'cors';
import { ChatRequest, ToolRequest } from '../types/api';

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Chat endpoint
app.post('/chat', async (req, res) => {
  try {
    const { message, model } = req.body as ChatRequest;
    // Simulate AI response for now
    const response = `Response from ${model}: ${message}`;
    res.json({ response });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Tool endpoint
app.post('/tool', async (req, res) => {
  try {
    const { tool_name, params } = req.body as ToolRequest;
    // Simulate tool execution for now
    res.json({
      tool: tool_name,
      params,
      result: `Simulated result for ${tool_name}`,
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Available tools endpoint
app.get('/available-tools', (_req, res) => {
  res.json({
    tools: [
      'brave_web_search',
      'brave_local_search',
      'github_search',
      'create_issue',
    ],
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
}); 