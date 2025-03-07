'use client';

import { useState } from 'react';
import { ChatMessage, ToolCall, ToolResult } from '@/types/api';
import { sendChatMessage } from '@/utils/api';
import ToolsPanel from './components/ToolsPanel';

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [selectedModel, setSelectedModel] = useState('ollama');
  const [isLoading, setIsLoading] = useState(false);
  const [isToolsPanelOpen, setIsToolsPanelOpen] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: input,
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await sendChatMessage({
        message: input,
        model: selectedModel,
      });

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: response.response,
      };

      if (response.tool_results?.length) {
        // Add tool results as separate messages
        response.tool_results.forEach((result: ToolResult) => {
          const toolMessage: ChatMessage = {
            role: 'tool',
            content: result.error || result.result,
          };
          setMessages(prev => [...prev, toolMessage]);
        });
      }

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: 'Sorry, there was an error processing your request.',
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const renderMessage = (message: ChatMessage) => {
    const getMessageStyle = () => {
      switch (message.role) {
        case 'user':
          return 'bg-blue-600/20 border border-blue-500/30 ml-auto';
        case 'tool':
          return 'bg-green-600/20 border border-green-500/30';
        default:
          return 'bg-gray-800/40 border border-gray-700/30 mr-auto';
      }
    };

    return (
      <div className={`p-4 rounded-lg shadow-lg transition-all duration-200 max-w-[80%] ${getMessageStyle()}`}>
        {message.role === 'tool' && (
          <div className="text-xs text-green-400 mb-1">Tool Result</div>
        )}
        <p className="whitespace-pre-wrap">{message.content}</p>
        {message.tool_calls?.map((tool: ToolCall, index: number) => (
          <div key={index} className="mt-2 p-2 bg-gray-900/50 rounded border border-gray-700/50">
            <div className="text-xs text-yellow-400">Tool Call: {tool.function.name}</div>
            <pre className="mt-1 text-xs overflow-x-auto">
              {JSON.stringify(tool.function.arguments, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black text-white">
      <main className="container mx-auto max-w-4xl p-4 flex flex-col min-h-screen">
        <header className="py-6 border-b border-gray-800 flex justify-between items-center">
          <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-500">
            AI Chat Dashboard
          </h1>
          <button
            onClick={() => setIsToolsPanelOpen(true)}
            className="px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 hover:border-yellow-400/30 transition-colors duration-200"
          >
            View Tools
          </button>
        </header>
        
        <div className="flex-1 my-4 space-y-4 overflow-y-auto">
          {messages.map((message, index) => (
            <div key={index}>
              {renderMessage(message)}
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-yellow-400 border-t-transparent"></div>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="flex gap-2 p-4 bg-gray-800/50 rounded-lg border border-gray-700/50 backdrop-blur-sm">
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="px-4 py-2 rounded-lg bg-gray-900 text-white border border-gray-700 focus:border-yellow-400 focus:ring-2 focus:ring-yellow-400/20 focus:outline-none transition-all duration-200"
          >
            <option value="ollama">Ollama</option>
            <option value="gpt">GPT</option>
            <option value="claude">Claude</option>
            <option value="deepseek">Deepseek</option>
          </select>
          
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            className="flex-1 px-4 py-2 rounded-lg bg-gray-900 text-white border border-gray-700 focus:border-yellow-400 focus:ring-2 focus:ring-yellow-400/20 focus:outline-none placeholder-gray-500 transition-all duration-200"
          />
          
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-6 py-2 bg-gradient-to-r from-yellow-400 to-orange-500 text-gray-900 font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:from-yellow-500 hover:to-orange-600 transition-all duration-200 focus:ring-2 focus:ring-yellow-400/20 focus:outline-none"
          >
            Send
          </button>
        </form>
      </main>

      <ToolsPanel
        isOpen={isToolsPanelOpen}
        onClose={() => setIsToolsPanelOpen(false)}
      />
    </div>
  );
}
