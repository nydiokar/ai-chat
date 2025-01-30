import { TaskStatus, TaskPriority } from '../types/task.js';
import { debug } from '../config.js';

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
    navigation: [
      /^!rw$/i,           // Rewind
      /^!fw$/i,           // Forward
      /^!save(?: (.+))?$/i,  // Save with optional label
      /^!load (.+)$/i,    // Load with branch ID
      
      // Natural language alternatives
      /(?:go |move )?back(?: to previous)?/i,
      /(?:go |move )?forward/i,
      /save(?: this)?(?: conversation)?(?: as (.+))?/i,
      /load(?: conversation)? (.+)/i
    ]
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
    
    // First check for navigation commands as they're simpler
    if (input.startsWith('!')) {
      const navigationCommand = this.parseNavigationCommand(input);
      if (navigationCommand) return navigationCommand;
    }

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

  private parseNavigationCommand(input: string): ParsedCommand | null {
    const command = input.toLowerCase();
    
    if (command === '!rw') {
      return { command: 'conversation', action: 'rewind', parameters: {} };
    }
    
    if (command === '!fw') {
      return { command: 'conversation', action: 'forward', parameters: {} };
    }
    
    const saveMatch = command.match(/^!save(?: (.+))?$/);
    if (saveMatch) {
      return {
        command: 'conversation',
        action: 'save',
        parameters: { label: saveMatch[1] || null }
      };
    }
    
    const loadMatch = command.match(/^!load (.+)$/);
    if (loadMatch) {
      return {
        command: 'conversation',
        action: 'load',
        parameters: { branchId: loadMatch[1] }
      };
    }
    
    return null;
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

      case 'navigation':
        // Handle natural language navigation commands
        if (match[0].includes('back') || match[0].includes('previous')) {
          return { command: 'conversation', action: 'rewind', parameters: {} };
        }
        if (match[0].includes('forward')) {
          return { command: 'conversation', action: 'forward', parameters: {} };
        }
        if (match[0].includes('save')) {
          return {
            command: 'conversation',
            action: 'save',
            parameters: { label: match[1] || null }
          };
        }
        if (match[0].includes('load')) {
          return {
            command: 'conversation',
            action: 'load',
            parameters: { branchId: match[1] }
          };
        }
        break;

      default:
        throw new CommandParserError('Invalid command type');
    }

    throw new CommandParserError('Invalid command type');
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
