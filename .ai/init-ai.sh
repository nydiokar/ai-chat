#!/usr/bin/env bash
# Initialize .ai/ folder for a new project
# Usage: ./init-ai.sh [project-name] [main-goal]

set -e

PROJECT_NAME="${1:-My Project}"
MAIN_GOAL="${2:-Complete the project goals}"

echo "Initializing .ai/ folder..."

# Create .ai directory
mkdir -p .ai

# Copy template files
cp .ai-template/CONTEXT.md .ai/CONTEXT.md
cp .ai-template/RULES.md .ai/RULES.md
cp .ai-template/GUIDE.md .ai/GUIDE.md
cp .ai-template/HANDOFF.md .ai/HANDOFF.md

# Customize CONTEXT.md
TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M")
sed -i "s/\[PROJECT_NAME\]/$PROJECT_NAME/g" .ai/CONTEXT.md
sed -i "s/\[MAIN_GOAL\]/$MAIN_GOAL/g" .ai/CONTEXT.md
sed -i "s/YYYY-MM-DD HH:MM/$TIMESTAMP/g" .ai/CONTEXT.md
sed -i "s/\[LLM Name\]/Initialized by script/g" .ai/CONTEXT.md
sed -i "s/\[Not Started | In Progress | Blocked | Complete\]/Not Started/g" .ai/CONTEXT.md

echo "✅ .ai/ folder created!"
echo ""
echo "Next steps:"
echo "1. Edit .ai/GUIDE.md with your task list"
echo "2. Update .ai/CONTEXT.md with environment details"
echo "3. Tell your AI agent: 'Read .ai/ folder and begin work'"
