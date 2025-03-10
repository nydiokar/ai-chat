import { expect } from 'chai';
import { ReferenceSystemService } from '../../../services/memory/reference-system.service.js';
import { 
  ConversationContext,
  ReferenceChain,
  EntityReference
} from '../../../types/memory.js';
import type { Message } from '@prisma/client';
import { Role } from '../../../types/index.js';

// Helper function to create test messages
function createTestMessage(content: string): Message {
  return {
    id: Math.floor(Math.random() * 1000),
    content,
    role: 'user',
    createdAt: new Date(),
    conversationId: 1,
    tokenCount: content.split(' ').length,
    discordUserId: null,
    discordUsername: null,
    discordGuildId: null,
    discordChannelId: null,
    contextId: null
  };
}

describe('ReferenceSystemService', () => {
  let service: ReferenceSystemService;

  beforeEach(() => {
    service = ReferenceSystemService.getInstance();
  });

  describe('Pronoun Resolution', () => {
    it('should resolve pronouns to their correct entities', () => {
      const context: ConversationContext = {
        id: '1',
        conversationId: 1,
        topics: ['testing'],
        entities: ['John', 'Alice'],
        summary: 'Discussion about John and Alice',
        timestamp: new Date(),
        messages: []
      };

      const previousMessages: Message[] = [
        createTestMessage('John went to the store'),
        createTestMessage('He bought some groceries')
      ];

      const currentMessage: Message = createTestMessage('He came back home');

      const references = service.resolvePronounReferences(
        currentMessage,
        context,
        previousMessages
      );

      expect(references).to.have.lengthOf(1);
      expect(references[0].type).to.equal('pronoun');
      expect(references[0].resolvedValue?.toLowerCase()).to.equal('john');
      expect(references[0].confidence).to.be.greaterThan(0.5);
    });

    it('should handle multiple pronouns in a single message', () => {
      const context: ConversationContext = {
        id: '1',
        conversationId: 1,
        topics: ['conversation'],
        entities: ['John', 'Alice'],
        summary: 'Discussion about John and Alice',
        timestamp: new Date(),
        messages: []
      };

      const previousMessages: Message[] = [
        createTestMessage('John and Alice are friends')
      ];

      const currentMessage: Message = createTestMessage('He likes her cooking');

      const references = service.resolvePronounReferences(
        currentMessage,
        context,
        previousMessages
      );

      expect(references).to.have.lengthOf(2);
      const pronouns = references.map(ref => ref.resolvedValue?.toLowerCase());
      expect(pronouns).to.include.members(['john', 'alice']);
    });
  });

  describe('Implicit Reference Resolution', () => {
    it('should resolve implicit references using context clues', () => {
      const context: ConversationContext = {
        id: '1',
        conversationId: 1,
        topics: ['discussion'],
        entities: ['Project X'],
        summary: 'Discussion about Project X',
        timestamp: new Date(),
        messages: []
      };

      const previousMessages: Message[] = [
        createTestMessage('Project X is launching soon')
      ];

      const currentMessage: Message = createTestMessage('The above mentioned initiative is important');

      const references = service.resolveImplicitReferences(
        currentMessage,
        context,
        previousMessages
      );

      expect(references).to.have.lengthOf(1);
      expect(references[0].type).to.equal('implicit');
      expect(references[0].resolvedValue?.toLowerCase()).to.equal('project x');
      expect(references[0].confidence).to.be.greaterThan(0.7);
    });
  });

  describe('Cross-Conversation Reference Chains', () => {
    it('should build reference chains across multiple conversations', () => {
      const conversations: ConversationContext[] = [
        {
          id: '1',
          conversationId: 1,
          topics: ['project'],
          entities: ['Project X'],
          summary: 'Initial discussion about Project X',
          timestamp: new Date(Date.now() - 2000),
          messages: [createTestMessage('Let\'s discuss Project X')]
        },
        {
          id: '2',
          conversationId: 2,
          topics: ['project'],
          entities: ['Project X'],
          summary: 'Follow-up on Project X',
          timestamp: new Date(Date.now() - 1000),
          messages: [createTestMessage('Project X is progressing well')]
        }
      ];

      const chain = service.buildReferenceChain('Project X', conversations);

      expect(chain.references).to.have.lengthOf(2);
      expect(chain.conversationIds).to.have.members([1, 2]);
      expect(chain.rootEntityId).to.equal('Project X');
    });
  });

  describe('Reference Visualization', () => {
    it('should create a valid visualization structure', () => {
      const conversations: ConversationContext[] = [
        {
          id: '1',
          conversationId: 1,
          topics: ['project'],
          entities: ['Project X'],
          summary: 'Project X discussion',
          timestamp: new Date(),
          messages: [createTestMessage('Project X is important')]
        }
      ];

      const chain: ReferenceChain = {
        id: 'chain_1',
        references: [
          {
            type: 'explicit',
            sourceId: 'msg_1',
            targetId: 'Project X',
            confidence: 1.0,
            context: 'Project X is important'
          }
        ],
        rootEntityId: 'Project X',
        lastUpdated: new Date(),
        conversationIds: [1]
      };

      const visualization = service.createReferenceVisualization(chain, conversations);

      expect(visualization.nodes).to.have.lengthOf(2); // Root + message
      expect(visualization.edges).to.have.lengthOf(1);
      expect(visualization.nodes[0].type).to.equal('entity');
      expect(visualization.edges[0].confidence).to.equal(1.0);
    });
  });

  describe('Performance Requirements', () => {
    it('should process references within latency requirements', () => {
      const context: ConversationContext = {
        id: '1',
        conversationId: 1,
        topics: ['performance'],
        entities: ['System A', 'System B'],
        summary: 'System comparison',
        timestamp: new Date(),
        messages: []
      };

      const previousMessages: Message[] = Array(10).fill(null).map(() => 
        createTestMessage('Message about System A and System B')
      );

      const startTime = process.hrtime();
      
      service.resolvePronounReferences(
        createTestMessage('They are both important'),
        context,
        previousMessages
      );
      
      const [seconds, nanoseconds] = process.hrtime(startTime);
      const milliseconds = seconds * 1000 + nanoseconds / 1000000;
      
      expect(milliseconds).to.be.lessThan(50); // < 50ms requirement
    });
  });
});
