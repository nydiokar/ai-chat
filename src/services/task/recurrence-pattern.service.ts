import { RecurrencePattern, RecurrenceType } from '../../types/task.js';

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
    // Custom patterns use cron format, so interval validation is skipped
    if (!pattern.customPattern || !pattern.customPattern.trim()) {
      return false;
    }

    const parts = pattern.customPattern.trim().split(/\s+/);
    if (parts.length !== 5) {
      return false;
    }

    const [minute, hour, day, month, dayOfWeek] = parts;
    const validators = [
      { value: minute, min: 0, max: 59 },
      { value: hour, min: 0, max: 23 },
      { value: day, min: 1, max: 31 },
      { value: month, min: 1, max: 12 },
      { value: dayOfWeek, min: 0, max: 6 }
    ];

    const isValid = validators.every(({ value, min, max }) => {
      // Handle asterisk
      if (value === '*') {
        return true;
      }

      // Handle lists (e.g., "1,3,5")
      if (value.includes(',')) {
        return value.split(',').every(v => this.isValidNumberInRange(v, min, max));
      }

      // Handle step values (e.g., "*/2")
      if (value.includes('/')) {
        const [base, step] = value.split('/');
        if (base !== '*') {
          return false;
        }
        return this.isValidNumberInRange(step, 1, max - min + 1);
      }

      // Handle ranges (e.g., "1-5")
      if (value.includes('-')) {
        const [start, end] = value.split('-');
        return this.isValidNumberInRange(start, min, max) && 
               this.isValidNumberInRange(end, min, max) &&
               parseInt(start) < parseInt(end);
      }

      // Handle single numbers
      return this.isValidNumberInRange(value, min, max);
    });

    // For custom patterns, we ignore the interval check
    return isValid;
  }

  private static isValidNumberInRange(value: string, min: number, max: number): boolean {
    const num = parseInt(value);
    return !isNaN(num) && num >= min && num <= max;
  }

  /**
   * Parses a custom pattern value to get the next value after the current one
   */
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
        // Simple date comparison - no time components
        const currentDay = new Date(Date.UTC(
          lastOccurrence.getUTCFullYear(),
          lastOccurrence.getUTCMonth(),
          lastOccurrence.getUTCDate()
        ));
        
        console.log('DAILY - Current day:', currentDay.toISOString());

        // If we have an end date, check if we're already there
        if (pattern.endDate) {
          const endDay = new Date(Date.UTC(
            pattern.endDate.getUTCFullYear(),
            pattern.endDate.getUTCMonth(),
            pattern.endDate.getUTCDate()
          ));
          console.log('DAILY - End day:', endDay.toISOString());

          if (currentDay.getTime() >= endDay.getTime()) {
            console.log('DAILY - At or past end date');
            return null;
          }
        }

        // Calculate next day
        const nextDay = new Date(currentDay);
        nextDay.setUTCDate(currentDay.getUTCDate() + pattern.interval);
        console.log('DAILY - Next day:', nextDay.toISOString());

        return nextDay;
      }

      case RecurrenceType.WEEKLY: {
        if (!pattern.daysOfWeek || pattern.daysOfWeek.length === 0) {
          return null;
        }

        let result = new Date(utcLastOccurrence);
        result = this.setUTCTime(result); // Reset time to midnight UTC

        // Find the next valid day of week
        const sortedDays = [...pattern.daysOfWeek].sort((a, b) => a - b);
        const currentDayOfWeek = result.getUTCDay();
        
        // Find the next day in the current week
        const nextDayThisWeek = sortedDays.find(day => day > currentDayOfWeek);
        
        if (nextDayThisWeek !== undefined) {
          // We found a day later this week
          const daysToAdd = nextDayThisWeek - currentDayOfWeek;
          result.setUTCDate(result.getUTCDate() + daysToAdd);
        } else {
          // Move to first allowed day in next week
          const daysUntilNextWeek = 7 - currentDayOfWeek + sortedDays[0];
          result.setUTCDate(result.getUTCDate() + daysUntilNextWeek);
        }

        // Adjust for interval by moving forward if needed
        const weeksSinceStart = Math.floor((result.getTime() - utcLastOccurrence.getTime()) / (7 * 24 * 60 * 60 * 1000));
        if (weeksSinceStart % pattern.interval !== 0) {
          // Move to next valid interval
          const weeksToAdd = pattern.interval - (weeksSinceStart % pattern.interval);
          result.setUTCDate(result.getUTCDate() + (weeksToAdd * 7));
        }

        return result;
      }

      case RecurrenceType.MONTHLY: {
        if (!pattern.dayOfMonth) {
          return null;
        }

        const result = new Date(utcLastOccurrence);
        result.setUTCDate(1); // Move to first of month to avoid skipping months
        result.setUTCMonth(result.getUTCMonth() + pattern.interval);
        result.setUTCHours(0, 0, 0, 0);

        // Adjust to the desired day of month
        const maxDays = new Date(result.getUTCFullYear(), result.getUTCMonth() + 1, 0).getDate();
        const targetDay = Math.min(pattern.dayOfMonth, maxDays);
        result.setUTCDate(targetDay);

        // If we ended up with a date before or equal to the last occurrence,
        // move forward another interval
        if (result <= utcLastOccurrence) {
          result.setUTCDate(1);
          result.setUTCMonth(result.getUTCMonth() + pattern.interval);
          const nextMaxDays = new Date(result.getUTCFullYear(), result.getUTCMonth() + 1, 0).getDate();
          result.setUTCDate(Math.min(pattern.dayOfMonth, nextMaxDays));
        }

        return result;
      }

      case RecurrenceType.CUSTOM: {
        if (!pattern.customPattern) {
          return null;
        }

        const parts = pattern.customPattern.trim().split(/\s+/);
        if (parts.length !== 5) {
          return null;
        }

        const result = new Date(utcLastOccurrence);
        result.setUTCSeconds(0, 0);

        const [minutePattern, hourPattern, dayPattern, monthPattern, dowPattern] = parts;
        
        // Handle minute patterns first
        if (minutePattern === '*') {
          result.setUTCMinutes(result.getUTCMinutes() + 1);
        } else if (minutePattern.includes('/')) {
          const [, step] = minutePattern.split('/');
          const stepNum = parseInt(step);
          const currentMinute = result.getUTCMinutes();
          const nextStep = Math.ceil((currentMinute + 1) / stepNum) * stepNum;
          result.setUTCMinutes(nextStep);
        } else if (minutePattern.includes(',')) {
          const values = minutePattern.split(',').map(Number).sort((a, b) => a - b);
          const currentMinute = result.getUTCMinutes();
          const nextMinute = values.find(m => m > currentMinute) ?? values[0];
          if (nextMinute <= currentMinute) {
            result.setUTCHours(result.getUTCHours() + 1);
          }
          result.setUTCMinutes(nextMinute);
        } else {
          const specificMinute = parseInt(minutePattern);
          if (!isNaN(specificMinute)) {
            result.setUTCMinutes(specificMinute);
          }
        }

        // Handle hour pattern
        if (hourPattern !== '*') {
          const hour = parseInt(hourPattern);
          if (!isNaN(hour)) {
            result.setUTCHours(hour);
          }
        }

          // Handle weekday pattern
          if (dowPattern.includes('-')) {
            const [start, end] = dowPattern.split('-').map(Number);
            const currentDOW = result.getUTCDay();
            const currentHour = result.getUTCHours();
            const targetHour = parseInt(hourPattern);
            
            if (currentDOW < start) {
              // Move to next valid weekday
              result.setUTCDate(result.getUTCDate() + (start - currentDOW));
            } else if (currentDOW > end || 
                      (currentDOW === end && currentHour >= targetHour)) {
              // Move to start of next week
              result.setUTCDate(result.getUTCDate() + ((7 - currentDOW) + start));
            } else if (currentHour >= targetHour && currentDOW < end) {
              // Move to next day if we're past the target hour
              result.setUTCDate(result.getUTCDate() + 1);
            }
          }

        return result;
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

  private static matchesPattern(pattern: string, value: number, min: number, max: number): boolean {
    if (pattern === '*') return true;
    
    if (pattern.includes(',')) {
      return pattern.split(',').map(Number).includes(value);
    }
    
    if (pattern.includes('/')) {
      const [, step] = pattern.split('/');
      return value % parseInt(step) === 0;
    }
    
    if (pattern.includes('-')) {
      const [start, end] = pattern.split('-').map(Number);
      return value >= start && value <= end;
    }
    
    return parseInt(pattern) === value;
  }
}
