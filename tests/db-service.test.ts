import { expect } from 'chai';
import { DatabaseService } from '../src/services/db-service';

describe('DatabaseService', () => {
  let db: DatabaseService;

  beforeEach(() => {
    db = DatabaseService.getInstance();
  });

  describe('Conversation Management', () => {
    it('should create a new conversation', async () => {
      const id = await db.createConversation('gpt');
      expect(id).to.be.a('number');
    });

    it('should add messages to a conversation', async () => {
      const id = await db.createConversation('claude');
      await db.addMessage(id, 'Hello', 'user');
      await db.addMessage(id, 'Hi there!', 'assistant');

      const conversation = await db.getConversation(id);
      expect(conversation).to.not.be.null;
      expect(conversation?.messages).to.have.lengthOf(2);
      expect(conversation?.messages[0].content).to.equal('Hello');
      expect(conversation?.messages[0].role).to.equal('user');
      expect(conversation?.messages[1].content).to.equal('Hi there!');
      expect(conversation?.messages[1].role).to.equal('assistant');
    });

    it('should list conversations with correct order', async () => {
      await db.createConversation('gpt');
      await db.createConversation('claude');
      
      const conversations = await db.listConversations(2);
      expect(conversations).to.have.lengthOf(2);
      expect(conversations[0].createdAt.getTime()).to.be.greaterThan(conversations[1].createdAt.getTime());
    });

    it('should delete a conversation', async () => {
      const id = await db.createConversation('gpt');
      await db.deleteConversation(id);
      
      const conversation = await db.getConversation(id);
      expect(conversation).to.be.null;
    });
  });
});
