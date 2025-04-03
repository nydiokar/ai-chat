import { MCPError, ErrorType } from '../types/errors.js';
import { createLogContext } from './log-utils.js';
import { debug } from './logger.js';
import yaml from 'js-yaml';

/**
 * Validate the state of an AI component
 * @param component The component to validate
 * @param componentName Name of the component for error messages
 */
export function validateState(component: any, componentName: string): void {
  debug('Validating state', createLogContext(
    componentName,
    'validateState'
  ));

  // Check required properties exist
  if (!component.toolManager) {
    throw new MCPError(
      `${componentName} is not properly initialized: missing toolManager`,
      ErrorType.INITIALIZATION_ERROR
    );
  }

  // Validate provider if exists
  if ('llmProvider' in component && !component.llmProvider) {
    throw new MCPError(
      `${componentName} is not properly initialized: missing llmProvider`,
      ErrorType.INITIALIZATION_ERROR
    );
  }

  // Validate prompt generator if exists
  if ('promptGenerator' in component && !component.promptGenerator) {
    throw new MCPError(
      `${componentName} is not properly initialized: missing promptGenerator`,
      ErrorType.INITIALIZATION_ERROR
    );
  }
}

/**
 * Parse YAML response from LLM safely
 * @param response The YAML string to parse
 * @returns Parsed YAML object
 */
export function parseYamlResponse(response: string): any {
  try {
    debug('Parsing YAML response', createLogContext(
      'AIUtils',
      'parseYamlResponse',
      { responseLength: response.length }
    ));

    return yaml.load(response) || {};
  } catch (err) {
    throw new MCPError(
      'Failed to parse YAML response',
      ErrorType.PROCESSING_ERROR,
      { cause: err instanceof Error ? err : new Error(String(err)) }
    );
  }
}

/**
 * Validate input message
 * @param message The message to validate
 */
export function validateInput(message: string): void {
  if (!message || typeof message !== 'string') {
    throw new MCPError(
      'Invalid input: message must be a non-empty string',
      ErrorType.INVALID_INPUT
    );
  }

  if (message.trim().length === 0) {
    throw new MCPError(
      'Invalid input: message cannot be empty',
      ErrorType.INVALID_INPUT
    );
  }
} 