-- Add recurrence fields to Task table
ALTER TABLE Task ADD COLUMN isRecurring BOOLEAN DEFAULT false;
ALTER TABLE Task ADD COLUMN recurrencePattern TEXT;
ALTER TABLE Task ADD COLUMN originalTaskId INTEGER REFERENCES Task(id);

-- Add indexes for new fields
CREATE INDEX idx_task_isrecurring ON Task(isRecurring);
CREATE INDEX idx_task_originaltaskid ON Task(originalTaskId);
