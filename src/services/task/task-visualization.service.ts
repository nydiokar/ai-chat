import { TaskWithRelations, DependencyType } from '../../types/task';

export interface Node {
  id: number;
  label: string;
  status: string;
  priority: string;
}

export interface Edge {
  from: number;
  to: number;
  type: DependencyType;
}

export interface DependencyGraph {
  nodes: Node[];
  edges: Edge[];
}

export class TaskVisualizationService {
  /**
   * Generate a dependency graph representation of tasks and their relationships
   */
  generateDependencyGraph(tasks: TaskWithRelations[]): DependencyGraph {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const processedTasks = new Set<number>();

    // Recursively process tasks and their dependencies
    const processTask = (task: TaskWithRelations) => {
      if (processedTasks.has(task.id)) return;
      processedTasks.add(task.id);

      // Add node for current task
      nodes.push({
        id: task.id,
        label: task.title,
        status: task.status,
        priority: task.priority
      });

      // Only process blocking relationships to avoid duplicates
      // since blockedBy relationships will be covered when processing the blocker task
      if (task.blocking) {
        for (const dep of task.blocking) {
          edges.push({
            from: task.id,
            to: dep.blockedTaskId,
            type: dep.dependencyType as DependencyType
          });
        }
      }
    };

    // Process all tasks
    tasks.forEach(processTask);

    return { nodes, edges };
  }

  /**
   * Generate a Mermaid diagram representation of the dependency graph
   */
  generateMermaidDiagram(tasks: TaskWithRelations[]): string {
    const lines: string[] = ['graph TD;'];
    const processedEdges = new Set<string>();

    // Helper to generate node style based on task status
    const getNodeStyle = (task: TaskWithRelations): string => {
      switch (task.status) {
        case 'COMPLETED':
          return ':::completed';
        case 'BLOCKED':
          return ':::blocked';
        case 'IN_PROGRESS':
          return ':::inProgress';
        default:
          return '';
      }
    };

    // Helper to format edge based on dependency type
    const getEdgeStyle = (depType: DependencyType): string => {
      switch (depType) {
        case DependencyType.BLOCKS:
          return ' ==> ';
        case DependencyType.SEQUENTIAL:
          return ' --> ';
        case DependencyType.PARALLEL:
          return ' -.-> ';
        case DependencyType.REQUIRED:
          return ' === ';
        default:
          return ' --- ';
      }
    };

    // Add class definitions
    lines.push('classDef completed fill:#90EE90;');
    lines.push('classDef blocked fill:#FFB6C1;');
    lines.push('classDef inProgress fill:#87CEEB;');
    
    // Process each task
    tasks.forEach(task => {
      // Add node with status styling
      lines.push(`${task.id}["${task.title}"]${getNodeStyle(task)}`);

      // Process dependencies
      if (task.blocking) {
        task.blocking.forEach(dep => {
          const edgeKey = `${task.id}-${dep.blockedTaskId}`;
          if (!processedEdges.has(edgeKey)) {
            processedEdges.add(edgeKey);
            lines.push(`${task.id}${getEdgeStyle(dep.dependencyType as DependencyType)}${dep.blockedTaskId}`);
          }
        });
      }
    });

    return lines.join('\n');
  }

  /**
   * Generate a DOT graph representation for use with GraphViz
   */
  generateDotGraph(tasks: TaskWithRelations[]): string {
    const lines = ['digraph TaskDependencies {'];
    lines.push('  rankdir=TB;');
    lines.push('  node [shape=box, style=rounded];');
    
    // Add nodes
    tasks.forEach(task => {
      let color = 'white';
      switch (task.status) {
        case 'COMPLETED':
          color = 'lightgreen';
          break;
        case 'BLOCKED':
          color = 'lightpink';
          break;
        case 'IN_PROGRESS':
          color = 'lightskyblue';
          break;
      }
      
      lines.push(`  task${task.id} [label="${task.title}\\n[${task.status}]", fillcolor="${color}", style="filled,rounded"];`);
    });

    // Add edges with different styles for different dependency types
    tasks.forEach(task => {
      if (task.blocking) {
        task.blocking.forEach(dep => {
          let edgeStyle = '';
          switch (dep.dependencyType as DependencyType) {
            case DependencyType.BLOCKS:
              edgeStyle = '[style=bold]';
              break;
            case DependencyType.SEQUENTIAL:
              edgeStyle = '[style=solid]';
              break;
            case DependencyType.PARALLEL:
              edgeStyle = '[style=dashed]';
              break;
            case DependencyType.REQUIRED:
              edgeStyle = '[style=dotted]';
              break;
          }
          lines.push(`  task${task.id} -> task${dep.blockedTaskId} ${edgeStyle};`);
        });
      }
    });

    lines.push('}');
    return lines.join('\n');
  }
}
