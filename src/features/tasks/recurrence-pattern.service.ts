import { RecurrencePattern, RecurrenceType } from '../types/task.js';

export class RecurrencePatternService {
  private static isValidDayOfMonth(day: number): boolean {
    return day >= 1 && day <= 31;
  }

  private static isValidDayOfWeek(day: number): boolean {
    return day >= 0 && day <= 6;
  }

  private static validateDailyPattern(pattern: RecurrencePattern): boolean {
    return pattern.interval > 0;
  }

  private static validateWeeklyPattern(pattern: RecurrencePattern): boolean {
    if (!pattern.daysOfWeek || pattern.daysOfWeek.length === 0) {
      return false;
    }
    return pattern.interval > 0 && pattern.daysOfWeek.every(day => this.isValidDayOfWeek(day));
  }

  private static validateMonthlyPattern(pattern: RecurrencePattern): boolean {
    if (!pattern.dayOfMonth) {
      return false;
    }
    return pattern.interval > 0 && this.isValidDayOfMonth(pattern.dayOfMonth);
  }

  /**
   * Validates a cron-like custom pattern
   * Pattern format: "minute hour day month dayOfWeek"
   * Each field can be:
   * - A number (e.g., 1, 15)
   * - A range (e.g., 1-5)
   * - A step value (e.g., "* /2" without the space)
   * - A list (e.g., 1,3,5)
   * - An asterisk (*) for any value
   */
  private static validateCustomPattern(pattern: RecurrencePattern): boolean {
    if (!pattern.customPattern || !pattern.customPattern.trim()) {
      return false;
    }

    const parts = pattern.customPattern.trim().split(/\s+/);
    if (parts.length !== 5) {
      return false;
    }

    // First validate the format of each part
    const validators = [
      { pattern: parts[0], min: 0, max: 59 },  // minutes
      { pattern: parts[1], min: 0, max: 23 },  // hours
      { pattern: parts[2], min: 1, max: 31 },  // days
      { pattern: parts[3], min: 1, max: 12 },  // months
      { pattern: parts[4], min: 0, max: 6 }    // days of week
    ];

    // First pass: validate format using isValidNumberInRange
    for (const { pattern: part, min, max } of validators) {
      if (part === '*') continue;
      
      if (part.includes(',')) {
        if (!part.split(',').every(v => this.isValidNumberInRange(v, min, max))) {
          return false;
        }
      } else if (part.includes('/')) {
        const [base, step] = part.split('/');
        if (base !== '*' || !this.isValidNumberInRange(step, 1, max - min + 1)) {
          return false;
        }
      } else if (part.includes('-')) {
        const [start, end] = part.split('-');
        if (!this.isValidNumberInRange(start, min, max) || 
            !this.isValidNumberInRange(end, min, max) ||
            parseInt(start) >= parseInt(end)) {
          return false;
        }
      } else if (!this.isValidNumberInRange(part, min, max)) {
        return false;
      }
    }

    // Second pass: verify at least one valid value exists for each part
    return validators.every(({ pattern: part, min, max }) => {
      for (let value = min; value <= max; value++) {
        if (this.matchesPattern(part, value, min, max)) {
          return true;
        }
      }
      return false;
    });
  }

  private static dateMatchesCustomPattern(date: Date, customPattern: string): boolean {
    const parts = customPattern.trim().split(/\s+/);
    if (parts.length !== 5) {
      return false;
    }

    return this.matchesPattern(parts[0], date.getUTCMinutes(), 0, 59) &&
           this.matchesPattern(parts[1], date.getUTCHours(), 0, 23) &&
           this.matchesPattern(parts[2], date.getUTCDate(), 1, 31) &&
           this.matchesPattern(parts[3], date.getUTCMonth() + 1, 1, 12) &&
           this.matchesPattern(parts[4], date.getUTCDay(), 0, 6);
  }

  /**
   * Parses a custom pattern value to get the next value after the current one
   */
  static getNextValueInPattern(
    pattern: string,
    current: number,
    min: number,
    max: number
  ): number | null {
    // Handle asterisk
    if (pattern === '*') {
      return current + 1 > max ? min : current + 1;
    }

    // Handle lists
    if (pattern.includes(',')) {
      const values = pattern.split(',').map(v => parseInt(v)).sort((a, b) => a - b);
      const next = values.find(v => v > current);
      return next !== undefined ? next : values[0];
    }

    // Handle step values
    if (pattern.includes('/')) {
      const [, step] = pattern.split('/');
      const stepNum = parseInt(step);
      let next = Math.ceil((current + 1) / stepNum) * stepNum;
      return next > max ? null : next;
    }

    // Handle ranges
    if (pattern.includes('-')) {
      const [start, end] = pattern.split('-').map(v => parseInt(v));
      if (current >= end) {
        return null;
      }
      return current < start ? start : current + 1;
    }

    // Handle single numbers
    const num = parseInt(pattern);
    return current >= num ? null : num;
  }

  /**
   * Validates a recurrence pattern based on its type and parameters
   */
  static validatePattern(pattern: RecurrencePattern): boolean {
    if (!pattern || !pattern.type) {
      return false;
    }

    // Keep this validation - it will now work correctly with our frozen clock
    if (pattern.endDate && pattern.endDate < new Date()) {
      return false;
    }

    if (pattern.endAfterOccurrences !== undefined && pattern.endAfterOccurrences <= 0) {
      return false;
    }

    // Validate pattern based on type
    switch (pattern.type) {
      case RecurrenceType.DAILY:
        return this.validateDailyPattern(pattern);
      case RecurrenceType.WEEKLY:
        return this.validateWeeklyPattern(pattern);
      case RecurrenceType.MONTHLY:
        return this.validateMonthlyPattern(pattern);
      case RecurrenceType.CUSTOM:
        return this.validateCustomPattern(pattern);
      default:
        return false;
    }
  }

  // Add these utility functions at the top of the class
  private static toUTC(date: Date): Date {
    return new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds()
    ));
  }

  private static setUTCTime(date: Date, hours: number = 0, minutes: number = 0, seconds: number = 0): Date {
    const utcDate = this.toUTC(date);
    utcDate.setUTCHours(hours, minutes, seconds, 0);
    return utcDate;
  }

  /**
   * Calculates the next occurrence date based on the pattern and last occurrence
   */
  static getNextOccurrence(pattern: RecurrencePattern, lastOccurrence: Date): Date | null {
    if (!this.validatePattern(pattern)) {
      return null;
    }

    // Convert input to UTC
    const utcLastOccurrence = this.toUTC(lastOccurrence);
    let nextDate = new Date(utcLastOccurrence);

    switch (pattern.type) {
        case RecurrenceType.DAILY: {
            // Reset time components for daily pattern
            nextDate.setUTCHours(0, 0, 0, 0);
            
            console.log('DAILY - Current day:', nextDate.toISOString());

            if (pattern.endDate) {
                const endDay = this.toUTC(pattern.endDate);
                endDay.setUTCHours(0, 0, 0, 0);
                console.log('DAILY - End day:', endDay.toISOString());

                if (nextDate.getTime() >= endDay.getTime()) {
                    console.log('DAILY - At or past end date');
                    return null;
                }
            }

            nextDate.setUTCDate(nextDate.getUTCDate() + pattern.interval);
            console.log('DAILY - Next day:', nextDate.toISOString());

            return nextDate;
        }

      case RecurrenceType.WEEKLY: {
        if (!pattern.daysOfWeek || pattern.daysOfWeek.length === 0) {
          return null;
        }

        nextDate = this.setUTCTime(nextDate); // Reset time to midnight UTC

        // Find the next valid day of week
        const sortedDays = [...pattern.daysOfWeek].sort((a, b) => a - b);
        const currentDayOfWeek = nextDate.getUTCDay();
        
        // Find the next day in the current week
        const nextDayThisWeek = sortedDays.find(day => day > currentDayOfWeek);
        
        if (nextDayThisWeek !== undefined) {
          // We found a day later this week
          const daysToAdd = nextDayThisWeek - currentDayOfWeek;
          nextDate.setUTCDate(nextDate.getUTCDate() + daysToAdd);
        } else {
          // Move to first allowed day in next week
          const daysUntilNextWeek = 7 - currentDayOfWeek + sortedDays[0];
          nextDate.setUTCDate(nextDate.getUTCDate() + daysUntilNextWeek);
        }

        // Adjust for interval by moving forward if needed
        const weeksSinceStart = Math.floor((nextDate.getTime() - utcLastOccurrence.getTime()) / (7 * 24 * 60 * 60 * 1000));
        if (weeksSinceStart % pattern.interval !== 0) {
          // Move to next valid interval
          const weeksToAdd = pattern.interval - (weeksSinceStart % pattern.interval);
          nextDate.setUTCDate(nextDate.getUTCDate() + (weeksToAdd * 7));
        }

        return nextDate;
      }

      case RecurrenceType.MONTHLY: {
        if (!pattern.dayOfMonth) {
          return null;
        }

        nextDate = this.setUTCTime(nextDate); // Reset time to midnight UTC
        nextDate.setUTCDate(1); // Move to first of month to avoid skipping months
        nextDate.setUTCMonth(nextDate.getUTCMonth() + pattern.interval);

        // Adjust to the desired day of month
        const maxDays = new Date(nextDate.getUTCFullYear(), nextDate.getUTCMonth() + 1, 0).getDate();
        const targetDay = Math.min(pattern.dayOfMonth, maxDays);
        nextDate.setUTCDate(targetDay);

        // If we ended up with a date before or equal to the last occurrence,
        // move forward another interval
        if (nextDate <= utcLastOccurrence) {
          nextDate.setUTCDate(1);
          nextDate.setUTCMonth(nextDate.getUTCMonth() + pattern.interval);
          const nextMaxDays = new Date(nextDate.getUTCFullYear(), nextDate.getUTCMonth() + 1, 0).getDate();
          nextDate.setUTCDate(Math.min(pattern.dayOfMonth, nextMaxDays));
        }

        return nextDate;
      }

      case RecurrenceType.CUSTOM: {
        if (!pattern.customPattern) {
          return null;
        }

        const parts = pattern.customPattern.trim().split(/\s+/);
        if (parts.length !== 5) {
          return null;
        }

        nextDate.setUTCSeconds(0, 0); // Reset seconds for custom pattern

        // Try the next few minutes until we find a matching date
        for (let attempts = 0; attempts < 1440; attempts++) { // Max 24 hours of attempts
          // First use parseCustomPatternPart to get next values
          const nextMinute = this.parseCustomPatternPart(parts[0], nextDate.getUTCMinutes(), 0, 59);
          if (nextMinute === null) {
            nextDate.setUTCHours(nextDate.getUTCHours() + 1);
            nextDate.setUTCMinutes(0);
          } else {
            nextDate.setUTCMinutes(nextMinute);
          }

          // Verify the entire date matches the pattern
          if (this.dateMatchesCustomPattern(nextDate, pattern.customPattern)) {
            return nextDate;
          }
        }

        return null; // No matching date found within 24 hours
      }

      default:
        return null;
    }

  }

  /**
   * Determines if a task should be spawned based on its recurrence pattern
   */
  static shouldSpawnTask(pattern: RecurrencePattern, lastSpawnDate: Date): boolean {
    const nextOccurrence = this.getNextOccurrence(pattern, lastSpawnDate);
    if (!nextOccurrence) {
      return false;
    }

    return nextOccurrence <= new Date();
  }

  /**
   * Calculates all occurrence dates up to a specified date or number of occurrences
   */
  static getOccurrences(
    pattern: RecurrencePattern, 
    startDate: Date, 
    maxOccurrences: number = 10
  ): Date[] {
    console.log('getOccurrences - Input:', {
      startDate: startDate.toISOString(),
      maxOccurrences,
      endDate: pattern.endDate?.toISOString(),
      endAfterOccurrences: pattern.endAfterOccurrences
    });

    const occurrences: Date[] = [];
    let currentDate = startDate;

    const limit = pattern.endAfterOccurrences 
      ? Math.min(maxOccurrences, pattern.endAfterOccurrences)
      : maxOccurrences;
    
    console.log('getOccurrences - Using limit:', limit);

    while (occurrences.length < limit) {
      console.log('getOccurrences - Current length:', occurrences.length);
      const nextDate = this.getNextOccurrence(pattern, currentDate);
      console.log('getOccurrences - Next date:', nextDate?.toISOString());
      
      if (!nextDate) {
        console.log('getOccurrences - No next date, breaking');
        break;
      }

      if (pattern.endDate) {
        const utcEndDate = this.toUTC(pattern.endDate);
        utcEndDate.setUTCHours(23, 59, 59, 999);
        console.log('getOccurrences - Comparing with end date:', {
          next: nextDate.toISOString(),
          end: utcEndDate.toISOString()
        });
        if (nextDate > utcEndDate) {
          console.log('getOccurrences - Past end date, breaking');
          break;
        }
      }

      console.log('getOccurrences - Adding date:', nextDate.toISOString());
      occurrences.push(nextDate);
      currentDate = nextDate;
    }

    console.log('getOccurrences - Final result:', occurrences.map(d => d.toISOString()));
    return occurrences;
  }

  private static parseCustomPatternPart(pattern: string, currentValue: number, min: number, max: number): number | null {
    // Handle asterisk
    if (pattern === '*') {
      return currentValue + 1 > max ? min : currentValue + 1;
    }

    // Handle lists (e.g., "1,3,5")
    if (pattern.includes(',')) {
      const values = pattern.split(',')
        .map(v => parseInt(v))
        .sort((a, b) => a - b);
      const next = values.find(v => v > currentValue);
      return next !== undefined ? next : values[0];
    }

    // Handle step values (e.g., "*/15")
    if (pattern.includes('/')) {
      const [, step] = pattern.split('/');
      const stepNum = parseInt(step);
      const nextValue = Math.ceil((currentValue + 1) / stepNum) * stepNum;
      return nextValue <= max ? nextValue : min;
    }

    // Handle ranges (e.g., "1-5")
    if (pattern.includes('-')) {
      const [start, end] = pattern.split('-').map(v => parseInt(v));
      if (currentValue >= end) {
        return start;
      }
      return currentValue < start ? start : currentValue + 1;
    }

    // Handle single numbers
    const num = parseInt(pattern);
    return !isNaN(num) && num >= min && num <= max ? num : null;
  }

  private static isValidNumberInRange(value: string, min: number, max: number): boolean {
    const num = parseInt(value);
    return !isNaN(num) && num >= min && num <= max;
  }

  private static matchesPattern(pattern: string, value: number, min: number, max: number): boolean {
    if (value < min || value > max) return false;
    
    if (pattern === '*') return true;
    
    if (pattern.includes(',')) {
      const values = pattern.split(',').map(Number);
      return values.every(v => v >= min && v <= max) && values.includes(value);
    }
    
    if (pattern.includes('/')) {
      const [, step] = pattern.split('/');
      const stepNum = parseInt(step);
      return stepNum >= min && stepNum <= (max - min) && value % stepNum === 0;
    }
    
    if (pattern.includes('-')) {
      const [start, end] = pattern.split('-').map(Number);
      return start >= min && end <= max && value >= start && value <= end;
    }
    
    const num = parseInt(pattern);
    return !isNaN(num) && num >= min && num <= max && num === value;
  }
}
