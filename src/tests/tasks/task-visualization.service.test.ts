import { describe, it } from 'mocha';
import { expect } from 'chai';
import { TaskVisualizationService } from '../../features/tasks/task-visualization.service.js';
import { DependencyType, TaskPriority, TaskStatus, TaskWithRelations } from '../../types/task.js';

describe('TaskVisualizationService', () => {
  const visualizationService = new TaskVisualizationService();

  // Helper function to create mock tasks
  const createMockTask = (id: number, title: string, status: TaskStatus, blocking: any[] = [], blockedBy: any[] = []): TaskWithRelations => ({
    id,
    title,
    description: `Description for ${title}`,
    status,
    priority: TaskPriority.MEDIUM,
    createdAt: new Date(),
    updatedAt: new Date(),
    creatorId: 'test-user',
    tags: {},
    blocking,
    blockedBy,
    creator: {
      id: 'test-user',
      username: 'Test User',
      createdAt: new Date(),
      updatedAt: new Date(),
      isActive: true
    },
    subTasks: [],
    history: []
  });

  describe('generateDependencyGraph', () => {
    it('should generate correct graph structure for simple dependencies', () => {
      const task1 = createMockTask(1, 'Task 1', TaskStatus.COMPLETED);
      const task2 = createMockTask(2, 'Task 2', TaskStatus.BLOCKED);
      const task3 = createMockTask(3, 'Task 3', TaskStatus.OPEN);

      // Set up dependencies: task1 -> task2 -> task3
      task1.blocking = [{
        id: 1,
        blockedTaskId: 2,
        blockerTaskId: 1,
        dependencyType: DependencyType.BLOCKS,
        createdAt: new Date(),
        updatedAt: new Date()
      }];

      task2.blocking = [{
        id: 2,
        blockedTaskId: 3,
        blockerTaskId: 2,
        dependencyType: DependencyType.SEQUENTIAL,
        createdAt: new Date(),
        updatedAt: new Date()
      }];

      task2.blockedBy = task1.blocking;
      task3.blockedBy = task2.blocking;

      const graph = visualizationService.generateDependencyGraph([task1, task2, task3]);

      expect(graph.nodes).to.have.length(3);
      expect(graph.edges).to.have.length(2);

      // Verify nodes
      const nodeIds = graph.nodes.map(n => n.id);
      expect(nodeIds).to.include.members([1, 2, 3]);

      // Verify edges
      const edge1 = graph.edges.find(e => e.from === 1 && e.to === 2);
      const edge2 = graph.edges.find(e => e.from === 2 && e.to === 3);

      expect(edge1).to.exist;
      expect(edge1?.type).to.equal(DependencyType.BLOCKS);
      expect(edge2).to.exist;
      expect(edge2?.type).to.equal(DependencyType.SEQUENTIAL);
    });

    it('should handle parallel dependencies correctly', () => {
      const task1 = createMockTask(1, 'Task 1', TaskStatus.IN_PROGRESS);
      const task2 = createMockTask(2, 'Task 2', TaskStatus.IN_PROGRESS);
      const task3 = createMockTask(3, 'Task 3', TaskStatus.BLOCKED);

      // Set up parallel dependencies: task1 -> task3 and task2 -> task3
      task1.blocking = [{
        id: 1,
        blockedTaskId: 3,
        blockerTaskId: 1,
        dependencyType: DependencyType.PARALLEL,
        createdAt: new Date(),
        updatedAt: new Date()
      }];

      task2.blocking = [{
        id: 2,
        blockedTaskId: 3,
        blockerTaskId: 2,
        dependencyType: DependencyType.PARALLEL,
        createdAt: new Date(),
        updatedAt: new Date()
      }];

      task3.blockedBy = [...task1.blocking, ...task2.blocking];

      const graph = visualizationService.generateDependencyGraph([task1, task2, task3]);

      expect(graph.nodes).to.have.length(3);
      expect(graph.edges).to.have.length(2);

      // Verify parallel edges
      const parallelEdges = graph.edges.filter(e => e.type === DependencyType.PARALLEL);
      expect(parallelEdges).to.have.length(2);
    });
  });

  describe('generateMermaidDiagram', () => {
    it('should generate valid Mermaid diagram syntax', () => {
      const task1 = createMockTask(1, 'Task 1', TaskStatus.COMPLETED);
      const task2 = createMockTask(2, 'Task 2', TaskStatus.IN_PROGRESS);

      task1.blocking = [{
        id: 1,
        blockedTaskId: 2,
        blockerTaskId: 1,
        dependencyType: DependencyType.BLOCKS,
        createdAt: new Date(),
        updatedAt: new Date()
      }];
      task2.blockedBy = task1.blocking;

      const diagram = visualizationService.generateMermaidDiagram([task1, task2]);

      expect(diagram).to.include('graph TD;');
      expect(diagram).to.include('classDef completed');
      expect(diagram).to.include('classDef inProgress');
      expect(diagram).to.match(/1\["Task 1"\]:::completed/);
      expect(diagram).to.match(/2\["Task 2"\]:::inProgress/);
      expect(diagram).to.include('1 ==> 2');
    });
  });

  describe('generateDotGraph', () => {
    it('should generate valid DOT graph syntax', () => {
      const task1 = createMockTask(1, 'Task 1', TaskStatus.COMPLETED);
      const task2 = createMockTask(2, 'Task 2', TaskStatus.BLOCKED);

      task1.blocking = [{
        id: 1,
        blockedTaskId: 2,
        blockerTaskId: 1,
        dependencyType: DependencyType.SEQUENTIAL,
        createdAt: new Date(),
        updatedAt: new Date()
      }];
      task2.blockedBy = task1.blocking;

      const dot = visualizationService.generateDotGraph([task1, task2]);

      expect(dot).to.include('digraph TaskDependencies {');
      expect(dot).to.include('rankdir=TB;');
      expect(dot).to.match(/task1.*Task 1.*COMPLETED/);
      expect(dot).to.match(/task2.*Task 2.*BLOCKED/);
      expect(dot).to.include('task1 -> task2 [style=solid]');
      expect(dot).to.include('}');
    });
  });
});
