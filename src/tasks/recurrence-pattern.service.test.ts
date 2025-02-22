import { expect } from 'chai';
import sinon from 'sinon';
import { RecurrencePatternService } from './recurrence-pattern.service.js';
import { RecurrencePattern, RecurrenceType } from '../types/task.js';

describe('RecurrencePatternService', () => {
  let clock: sinon.SinonFakeTimers;

  before(() => {
    // Freeze system time to January 1, 2025, 00:00:00 UTC
    clock = sinon.useFakeTimers({
      now: new Date(Date.UTC(2025, 0, 1)).getTime(),
      toFake: ['Date']
    });
  });

  after(() => {
    clock.restore();
  });

  describe('validatePattern', () => {
    it('should validate custom pattern', () => {
      const pattern: RecurrencePattern = {
        type: RecurrenceType.CUSTOM,
        customPattern: '* * * * *',
        interval: 0
      };
      expect(RecurrencePatternService.validatePattern(pattern)).to.be.true;

      pattern.customPattern = '0 9 * * 1-5'; // At 9:00 AM, Monday through Friday
      expect(RecurrencePatternService.validatePattern(pattern)).to.be.true;

      pattern.customPattern = '*/15 * * * *'; // Every 15 minutes
      expect(RecurrencePatternService.validatePattern(pattern)).to.be.true;

      pattern.customPattern = '0,30 * * * *'; // Every hour at minute 0 and 30
      expect(RecurrencePatternService.validatePattern(pattern)).to.be.true;

      // Invalid patterns
      pattern.customPattern = '* * *'; // Too few fields
      expect(RecurrencePatternService.validatePattern(pattern)).to.be.false;

      pattern.customPattern = '60 * * * *'; // Invalid minute
      expect(RecurrencePatternService.validatePattern(pattern)).to.be.false;

      pattern.customPattern = '* 24 * * *'; // Invalid hour
      expect(RecurrencePatternService.validatePattern(pattern)).to.be.false;

      pattern.customPattern = '* * 32 * *'; // Invalid day
      expect(RecurrencePatternService.validatePattern(pattern)).to.be.false;

      pattern.customPattern = '* * * 13 *'; // Invalid month
      expect(RecurrencePatternService.validatePattern(pattern)).to.be.false;

      pattern.customPattern = '* * * * 7'; // Invalid day of week
      expect(RecurrencePatternService.validatePattern(pattern)).to.be.false;
    });

    it('should validate daily pattern', () => {
      const pattern: RecurrencePattern = {
        type: RecurrenceType.DAILY,
        interval: 1
      };
      expect(RecurrencePatternService.validatePattern(pattern)).to.be.true;

      pattern.interval = 0;
      expect(RecurrencePatternService.validatePattern(pattern)).to.be.false;
    });

    it('should validate weekly pattern', () => {
      const pattern: RecurrencePattern = {
        type: RecurrenceType.WEEKLY,
        interval: 1,
        daysOfWeek: [1, 3, 5] // Mon, Wed, Fri
      };
      expect(RecurrencePatternService.validatePattern(pattern)).to.be.true;

      pattern.daysOfWeek = [7]; // Invalid day
      expect(RecurrencePatternService.validatePattern(pattern)).to.be.false;

      pattern.daysOfWeek = []; // Empty days
      expect(RecurrencePatternService.validatePattern(pattern)).to.be.false;
    });

    it('should validate monthly pattern', () => {
      const pattern: RecurrencePattern = {
        type: RecurrenceType.MONTHLY,
        interval: 1,
        dayOfMonth: 15
      };
      expect(RecurrencePatternService.validatePattern(pattern)).to.be.true;

      pattern.dayOfMonth = 32; // Invalid day
      expect(RecurrencePatternService.validatePattern(pattern)).to.be.false;

      delete pattern.dayOfMonth; // Missing day
      expect(RecurrencePatternService.validatePattern(pattern)).to.be.false;
    });

    it('should validate end conditions', () => {
      const pattern: RecurrencePattern = {
        type: RecurrenceType.DAILY,
        interval: 1,
        endDate: new Date(Date.now() + 86400000) // Tomorrow
      };
      expect(RecurrencePatternService.validatePattern(pattern)).to.be.true;

      pattern.endDate = new Date(Date.now() - 86400000); // Yesterday
      expect(RecurrencePatternService.validatePattern(pattern)).to.be.false;

      delete pattern.endDate;
      pattern.endAfterOccurrences = 5;
      expect(RecurrencePatternService.validatePattern(pattern)).to.be.true;

      pattern.endAfterOccurrences = 0;
      expect(RecurrencePatternService.validatePattern(pattern)).to.be.false;
    });
  });

  describe('getNextOccurrence', () => {
    it('should calculate next custom occurrence - every minute', () => {
      const pattern: RecurrencePattern = {
        type: RecurrenceType.CUSTOM,
        customPattern: '* * * * *',
        interval: 0
      };
      const lastOccurrence = new Date(Date.UTC(2025, 1, 1, 10, 0, 0));
      const nextOccurrence = RecurrencePatternService.getNextOccurrence(pattern, lastOccurrence);
      expect(nextOccurrence?.toISOString()).to.equal('2025-02-01T10:01:00.000Z');
    });

    it('should calculate next custom occurrence - specific time', () => {
      const pattern: RecurrencePattern = {
        type: RecurrenceType.CUSTOM,
        customPattern: '0 9 * * *' // Every day at 9:00 AM
        ,
        interval: 0
      };
      const lastOccurrence = new Date(Date.UTC(2025, 1, 1, 8, 0, 0));
      const nextOccurrence = RecurrencePatternService.getNextOccurrence(pattern, lastOccurrence);
      expect(nextOccurrence?.toISOString()).to.equal(new Date(Date.UTC(2025, 1, 1, 9, 0, 0)).toISOString());
    });

    it('should calculate next custom occurrence - weekdays only', () => {
      const pattern: RecurrencePattern = {
        type: RecurrenceType.CUSTOM,
        customPattern: '0 9 * * 1-5' // At 9:00 AM, Monday through Friday
        ,
        interval: 0
      };
      // Starting from Sunday (0)
      const sundayOccurrence = RecurrencePatternService.getNextOccurrence(pattern, new Date(Date.UTC(2025, 1, 2, 8, 0, 0)));
      expect(sundayOccurrence?.toISOString()).to.equal(new Date(Date.UTC(2025, 1, 3, 9, 0, 0)).toISOString()); // Should be Monday

      // Starting from Friday after work hours
      const fridayOccurrence = RecurrencePatternService.getNextOccurrence(pattern, new Date(Date.UTC(2025, 1, 7, 18, 0, 0)));
      expect(fridayOccurrence?.toISOString()).to.equal(new Date(Date.UTC(2025, 1, 10, 9, 0, 0)).toISOString()); // Should be next Monday
    });

    it('should calculate next custom occurrence - with intervals', () => {
      const pattern: RecurrencePattern = {
        type: RecurrenceType.CUSTOM,
        customPattern: '*/15 * * * *' // Every 15 minutes
        ,
        interval: 0
      };
      const lastOccurrence = new Date(Date.UTC(2025, 1, 1, 10, 0, 0));
      const nextOccurrence = RecurrencePatternService.getNextOccurrence(pattern, lastOccurrence);
      expect(nextOccurrence?.toISOString()).to.equal(new Date(Date.UTC(2025, 1, 1, 10, 15, 0)).toISOString());
    });

    it('should calculate next custom occurrence - with lists', () => {
      const pattern: RecurrencePattern = {
        type: RecurrenceType.CUSTOM,
        customPattern: '0,30 * * * *' // Every hour at minute 0 and 30
        ,
        interval: 0
      };
      const lastOccurrence = new Date(Date.UTC(2025, 1, 1, 10, 15, 0));
      const nextOccurrence = RecurrencePatternService.getNextOccurrence(pattern, lastOccurrence);
      expect(nextOccurrence?.toISOString()).to.equal(new Date(Date.UTC(2025, 1, 1, 10, 30, 0)).toISOString());
    });

    it('should calculate next daily occurrence', () => {
      const pattern: RecurrencePattern = {
        type: RecurrenceType.DAILY,
        interval: 1
      };
      const lastOccurrence = new Date(Date.UTC(2025, 1, 1));
      const nextOccurrence = RecurrencePatternService.getNextOccurrence(pattern, lastOccurrence);
      expect(nextOccurrence?.toDateString()).to.equal(new Date(Date.UTC(2025, 1, 2)).toDateString());
    });


    it('should calculate next weekly occurrence', () => {
      const pattern: RecurrencePattern = {
        type: RecurrenceType.WEEKLY,
        interval: 1,
        daysOfWeek: [1, 3, 5] // Mon, Wed, Fri
      };
      // Starting from Sunday (0)
      const lastOccurrence = new Date(Date.UTC(2025, 1, 2));
      const nextOccurrence = RecurrencePatternService.getNextOccurrence(pattern, lastOccurrence);
      expect(nextOccurrence?.toDateString()).to.equal(new Date(Date.UTC(2025, 1, 3)).toDateString()); // Should be Monday

      // Starting from Friday (5)
      const fridayOccurrence = RecurrencePatternService.getNextOccurrence(pattern, new Date(Date.UTC(2025, 1, 7)));
      expect(fridayOccurrence?.toDateString()).to.equal(new Date(Date.UTC(2025, 1, 10)).toDateString()); // Should be next Monday
    });

    it('should calculate next monthly occurrence', () => {
      const pattern: RecurrencePattern = {
        type: RecurrenceType.MONTHLY,
        interval: 1,
        dayOfMonth: 15
      };
      const lastOccurrence = new Date(Date.UTC(2025, 1, 15));
      const nextOccurrence = RecurrencePatternService.getNextOccurrence(pattern, lastOccurrence);
      expect(nextOccurrence?.toDateString()).to.equal(new Date(Date.UTC(2025, 2, 15)).toDateString());
    });

    it('should handle end conditions', () => {
      const pattern: RecurrencePattern = {
        type: RecurrenceType.DAILY,
        interval: 1,
        endDate: new Date(Date.UTC(2025, 1, 3))
      };
      const lastOccurrence = new Date(Date.UTC(2025, 1, 2));
      const nextOccurrence = RecurrencePatternService.getNextOccurrence(pattern, lastOccurrence);
      expect(nextOccurrence?.toDateString()).to.equal(new Date(Date.UTC(2025, 1, 3)).toDateString());

      // Should return null after end date
      const pastEndDate = RecurrencePatternService.getNextOccurrence(pattern, new Date(Date.UTC(2025, 1, 3)));
      expect(pastEndDate).to.be.null;
    });
  });

  describe('shouldSpawnTask', () => {
    it('should determine if task should spawn based on current time', () => {
      const pattern: RecurrencePattern = {
        type: RecurrenceType.DAILY,
        interval: 1
      };
      const yesterday = new Date(Date.now() - 86400000);
      expect(RecurrencePatternService.shouldSpawnTask(pattern, yesterday)).to.be.true;

      const tomorrow = new Date(Date.now() + 86400000);
      expect(RecurrencePatternService.shouldSpawnTask(pattern, tomorrow)).to.be.false;
    });
  });

  describe('getOccurrences', () => {
    it('should get multiple occurrences up to max count', () => {
      const pattern: RecurrencePattern = {
        type: RecurrenceType.DAILY,
        interval: 1
      };
      const startDate = new Date(Date.UTC(2025, 1, 1));
      const occurrences = RecurrencePatternService.getOccurrences(pattern, startDate, 3);
      expect(occurrences).to.have.length(3);
      expect(occurrences[0].toDateString()).to.equal(new Date(Date.UTC(2025, 1, 2)).toDateString());
      expect(occurrences[1].toDateString()).to.equal(new Date(Date.UTC(2025, 1, 3)).toDateString());
      expect(occurrences[2].toDateString()).to.equal(new Date(Date.UTC(2025, 1, 4)).toDateString());
    });

    it('should respect end date limit', () => {
      const pattern: RecurrencePattern = {
        type: RecurrenceType.DAILY,
        interval: 1,
        endDate: new Date(Date.UTC(2025, 1, 3))
      };
      const startDate = new Date(Date.UTC(2025, 1, 1));
      const occurrences = RecurrencePatternService.getOccurrences(pattern, startDate, 5);
      expect(occurrences).to.have.length(2); // Should only get occurrences up to end date
      expect(occurrences[0].toDateString()).to.equal(new Date(Date.UTC(2025, 1, 2)).toDateString());
      expect(occurrences[1].toDateString()).to.equal(new Date(Date.UTC(2025, 1, 3)).toDateString());
    });

    it('should respect endAfterOccurrences limit', () => {
      const pattern: RecurrencePattern = {
        type: RecurrenceType.DAILY,
        interval: 1,
        endAfterOccurrences: 2
      };
      const startDate = new Date(Date.UTC(2025, 1, 1));
      const occurrences = RecurrencePatternService.getOccurrences(pattern, startDate, 5);
      expect(occurrences).to.have.length(2); // Should only get specified number of occurrences
      expect(occurrences[0].toDateString()).to.equal(new Date(Date.UTC(2025, 1, 2)).toDateString());
      expect(occurrences[1].toDateString()).to.equal(new Date(Date.UTC(2025, 1, 3)).toDateString());
    });
  });
});
