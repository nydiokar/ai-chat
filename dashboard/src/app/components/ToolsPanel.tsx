import { useEffect, useState } from 'react';
import { Tool, MCPServer } from '@/types/api';
import { getAvailableTools } from '@/utils/api';

interface ToolsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ToolsPanel({ isOpen, onClose }: ToolsPanelProps) {
  const [tools, setTools] = useState<Record<string, Tool>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTools() {
      try {
        setIsLoading(true);
        const response = await getAvailableTools();
        setTools(response.tools);
        setError(null);
      } catch (err) {
        setError('Failed to fetch available tools');
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }

    if (isOpen) {
      fetchTools();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-80 bg-gray-900 border-l border-gray-800 p-4 overflow-y-auto shadow-lg transform transition-transform duration-200">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-yellow-400">Available Tools</h2>
        <button
          onClick={onClose}
          className="p-2 hover:bg-gray-800 rounded-full transition-colors duration-200"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-4">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-yellow-400 border-t-transparent"></div>
        </div>
      ) : error ? (
        <div className="text-red-400 p-4 rounded-lg bg-red-900/20 border border-red-900">
          {error}
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(tools).map(([id, tool]) => (
            <div
              key={id}
              className="p-4 rounded-lg bg-gray-800/40 border border-gray-700/30 hover:border-yellow-400/30 transition-colors duration-200"
            >
              <div className="flex items-start justify-between">
                <h3 className="font-semibold text-yellow-400">{tool.name}</h3>
                <span className="text-xs px-2 py-1 rounded-full bg-gray-700">
                  {tool.mcpServer}
                </span>
              </div>
              <p className="text-sm text-gray-400 mt-2">{tool.description}</p>
              <div className="mt-2">
                <h4 className="text-xs font-semibold text-gray-500 uppercase">Required Parameters:</h4>
                <ul className="mt-1 space-y-1">
                  {tool.parameters.required.map((param) => (
                    <li key={param} className="text-sm text-gray-400">
                      • {param}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
} 