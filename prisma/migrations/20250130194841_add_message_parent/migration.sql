-- Add parentMessageId to Message model
ALTER TABLE Message ADD COLUMN parentMessageId INTEGER REFERENCES Message(id);

-- Add index for faster parent message lookups
CREATE INDEX idx_message_parent ON Message(parentMessageId);
