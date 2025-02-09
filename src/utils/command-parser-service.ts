import { TaskStatus } from '../types/task.js';
import { debug } from './config.js';

export interface ParsedCommand {
  command: string;
  action: string;
  parameters: Record<string, any>;
}

export class CommandParserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandParserError';
  }
}

export class CommandParserService {
  private static instance: CommandParserService;
  
  // Command patterns for natural language parsing
  private readonly patterns = {
    create: [
      /create (?:a )?(?:new )?task(?: called| titled)? "([^"]+)"(?: with description)? "([^"]+)"/i,
      /add (?:a )?(?:new )?task(?: called| titled)? "([^"]+)"(?: with description)? "([^"]+)"/i,
      /make (?:a )?(?:new )?task(?: called| titled)? "([^"]+)"(?: with description)? "([^"]+)"/i
    ],
    view: [
      /(?:show|view|display|get) task #?(\d+)/i,
      /(?:show|view|display|get) details for task #?(\d+)/i
    ],
    update: [
      /update task #?(\d+) status to (open|in progress|completed|cancelled|blocked)/i,
      /mark task #?(\d+) as (open|in progress|completed|cancelled|blocked)/i,
      /set task #?(\d+) to (open|in progress|completed|cancelled|blocked)/i
    ],
    assign: [
      /assign task #?(\d+) to <@(\d+)>/i,
      /give task #?(\d+) to <@(\d+)>/i
    ],
    list: [
      /(?:show|view|display|get|list)(?: all)? (?:my )?tasks/i,
      /(?:show|view|display|get|list)(?: all)? (open|in progress|completed|cancelled|blocked) tasks/i
    ],
    delete: [
      /(?:delete|remove) task #?(\d+)/i
    ],
  };

  private constructor() {}

  static getInstance(): CommandParserService {
    if (!CommandParserService.instance) {
      CommandParserService.instance = new CommandParserService();
    }
    return CommandParserService.instance;
  }

  parse(input: string): ParsedCommand {
    debug(`Parsing command: ${input}`);
    

    // Try each pattern set
    for (const [command, patterns] of Object.entries(this.patterns)) {
      for (const pattern of patterns) {
        const match = input.match(pattern);
        if (match) {
          return this.buildCommand(command, match);
        }
      }
    }

    // Try to understand unstructured input
    const words = input.toLowerCase().split(' ');
    
    // Check for task-related keywords
    if (words.some(w => ['task', 'todo', 'work', 'item'].includes(w))) {
      // Look for action keywords
      if (this.containsAny(words, ['create', 'add', 'make', 'new'])) {
        throw new CommandParserError('To create a task, use format: create task "title" "description"');
      }
      if (this.containsAny(words, ['show', 'view', 'display', 'get'])) {
        throw new CommandParserError('To view a task, use format: view task #id');
      }
      if (this.containsAny(words, ['update', 'change', 'modify'])) {
        throw new CommandParserError('To update a task, use format: update task #id status to [status]');
      }
      if (this.containsAny(words, ['assign', 'give'])) {
        throw new CommandParserError('To assign a task, use format: assign task #id to @user');
      }
      if (this.containsAny(words, ['list', 'all'])) {
        throw new CommandParserError('To list tasks, use format: list tasks or list [status] tasks');
      }
      if (this.containsAny(words, ['delete', 'remove'])) {
        throw new CommandParserError('To delete a task, use format: delete task #id');
      }
    }

    throw new CommandParserError(
      'Unrecognized command. Try:\n' +
      '- create task "title" "description"\n' +
      '- view task #id\n' +
      '- update task #id status to [status]\n' +
      '- assign task #id to @user\n' +
      '- list tasks\n' +
      '- delete task #id'
    );
  }

  private buildCommand(command: string, match: RegExpMatchArray): ParsedCommand {
    const params: Record<string, any> = {};

    switch (command) {
      case 'create':
        params.title = match[1];
        params.description = match[2];
        return { command: 'task', action: 'create', parameters: params };

      case 'view':
        params.id = parseInt(match[1]);
        return { command: 'task', action: 'view', parameters: params };

      case 'update':
        params.id = parseInt(match[1]);
        params.status = this.parseStatus(match[2]);
        return { command: 'task', action: 'update', parameters: params };

      case 'assign':
        params.id = parseInt(match[1]);
        params.assigneeId = match[2];
        return { command: 'task', action: 'assign', parameters: params };

      case 'list':
        if (match[1]) {
          params.status = this.parseStatus(match[1]);
        }
        return { command: 'task', action: 'list', parameters: params };

      case 'delete':
        params.id = parseInt(match[1]);
        return { command: 'task', action: 'delete', parameters: params };

      default:
        throw new CommandParserError('Invalid command type');
    }
  }

  private parseStatus(status: string): TaskStatus {
    const normalizedStatus = status.toUpperCase().replace(/\s+/g, '_');
    if (Object.values(TaskStatus).includes(normalizedStatus as TaskStatus)) {
      return normalizedStatus as TaskStatus;
    }
    throw new CommandParserError(`Invalid status: ${status}`);
  }

  private containsAny(words: string[], keywords: string[]): boolean {
    return words.some(word => keywords.includes(word));
  }
}
