import { expect } from 'chai';
import { TaskQueryService } from '../../tasks/task-query-service.js';
import { TaskManager } from '../../tasks/task-manager.js';
import { TaskStatus, TaskPriority, TaskListResult } from '../../types/task.js';
import sinon from 'sinon';

describe('TaskQueryService', () => {
  let taskQueryService: TaskQueryService;
  let taskManager: TaskManager;
  let listTasksStub: sinon.SinonStub;

  const testUserId = 'user123';
  const mockTaskResult: TaskListResult = {
    tasks: [],
    total: 0
  };

  beforeEach(() => {
    taskQueryService = TaskQueryService.getInstance();
    taskManager = TaskManager.getInstance();
    listTasksStub = sinon.stub(taskManager, 'listTasks').resolves(mockTaskResult);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('queryTasks', () => {
    it('should parse user context correctly', async () => {
      await taskQueryService.queryTasks('show my tasks', testUserId);
      expect(listTasksStub.calledOnce).to.be.true;
      expect(listTasksStub.firstCall.args[0]).to.deep.include({
        assigneeId: testUserId
      });

      await taskQueryService.queryTasks('tasks created by me', testUserId);
      expect(listTasksStub.secondCall.args[0]).to.deep.include({
        creatorId: testUserId
      });
    });

    it('should parse task status correctly', async () => {
      const statusQueries = [
        { query: 'show open tasks', expected: TaskStatus.OPEN },
        { query: 'find in progress tasks', expected: TaskStatus.IN_PROGRESS },
        { query: 'list completed tasks', expected: TaskStatus.COMPLETED },
        { query: 'show blocked tasks', expected: TaskStatus.BLOCKED }
      ];

      for (const { query, expected } of statusQueries) {
        await taskQueryService.queryTasks(query, testUserId);
        expect(listTasksStub.lastCall.args[0]).to.deep.include({
          status: expected
        });
      }
    });

    it('should parse task priority correctly', async () => {
      const priorityQueries = [
        { query: 'show high priority tasks', expected: TaskPriority.HIGH },
        { query: 'find urgent tasks', expected: TaskPriority.URGENT },
        { query: 'list low priority tasks', expected: TaskPriority.LOW }
      ];

      for (const { query, expected } of priorityQueries) {
        await taskQueryService.queryTasks(query, testUserId);
        expect(listTasksStub.lastCall.args[0]).to.deep.include({
          priority: expected
        });
      }
    });

    it('should parse pagination limit correctly', async () => {
      await taskQueryService.queryTasks('show tasks limit 5', testUserId);
      expect(listTasksStub.lastCall.args[0]).to.deep.include({
        limit: 5
      });
    });

    it('should combine multiple filters correctly', async () => {
      const query = "show me open tasks assigned to john with high priority";
      const filters = await taskQueryService.parseQuery(query, testUserId);
      
      expect(filters).to.deep.include({
        status: TaskStatus.OPEN,
        priority: TaskPriority.HIGH,
        assigneeId: 'user-john'
      });
    });

    it('should handle invalid queries gracefully', async () => {
      const result = await taskQueryService.queryTasks('invalid query', testUserId);
      expect(result).to.deep.equal(mockTaskResult);
      expect(listTasksStub.lastCall.args[0]).to.deep.equal({});
    });
  });

  describe('getExampleQueries', () => {
    it('should return a non-empty array of example queries', () => {
      const examples = taskQueryService.getExampleQueries();
      expect(examples).to.be.an('array').that.is.not.empty;
      examples.forEach(query => {
        expect(query).to.be.a('string').that.is.not.empty;
      });
    });
  });
});
