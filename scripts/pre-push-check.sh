#!/bin/bash

# Pre-push quality check script
# Run this before pushing to catch issues early

set -e

echo "🔍 Running pre-push quality checks..."
echo "====================================="

# Check if we're in a git repository
if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo "❌ Not in a git repository"
    exit 1
fi

# Check for unstaged changes
if ! git diff --quiet; then
    echo "⚠️  You have unstaged changes. Consider staging them first."
fi

# Run type checking
echo "🔧 Running TypeScript compiler..."
if npm run typecheck; then
    echo "✅ TypeScript compilation successful"
else
    echo "❌ TypeScript compilation failed"
    echo "💡 Fix TypeScript errors before pushing"
    exit 1
fi

# Check and fix formatting
echo "🎨 Checking code formatting..."
if npx prettier --check "src/**/*.{ts,js,json,md}" >/dev/null 2>&1; then
    echo "✅ Code is properly formatted"
else
    echo "⚠️  Formatting issues found. Auto-fixing..."
    npm run format
    echo "✅ Formatting fixed. Remember to stage these changes!"
fi

# Check and fix linting
echo "🧹 Checking linting..."
LINT_ERRORS=$(npm run lint 2>&1 | grep -c "error" || echo "0")
LINT_WARNINGS=$(npm run lint 2>&1 | grep -c "warning" || echo "0")

if [ "$LINT_ERRORS" -eq "0" ]; then
    echo "✅ No linting errors"
    if [ "$LINT_WARNINGS" -gt "0" ]; then
        echo "⚠️  $LINT_WARNINGS linting warnings (acceptable)"
    fi
else
    echo "❌ $LINT_ERRORS linting errors found. Auto-fixing..."
    npm run lint:fix

    # Check if auto-fix resolved all errors
    REMAINING_ERRORS=$(npm run lint 2>&1 | grep -c "error" || echo "0")
    if [ "$REMAINING_ERRORS" -eq "0" ]; then
        echo "✅ All linting errors auto-fixed"
    else
        echo "⚠️  $REMAINING_ERRORS linting errors remain - manual fixes needed"
        echo "💡 Run 'npm run lint' to see remaining issues"
    fi
fi

# Run tests if they exist
echo "🧪 Running tests..."
if npm run test:unit >/dev/null 2>&1; then
    echo "✅ Tests passed"
else
    echo "❌ Some tests failed"
    echo "💡 Run 'npm run test:unit' for details"
    exit 1
fi

# Final check for uncommitted changes from auto-fixes
if ! git diff --quiet; then
    echo ""
    echo "📝 Auto-fixes created changes:"
    git diff --name-only | head -5
    if [ $(git diff --name-only | wc -l) -gt 5 ]; then
        echo "... and $(($(git diff --name-only | wc -l) - 5)) more files"
    fi
    echo ""
    echo "💡 Stage and commit these quality improvements:"
    echo "   git add ."
    echo "   git commit -m '🤖 Quality: Auto-fix formatting and linting'"
fi

echo ""
echo "🎉 Pre-push checks completed successfully!"
echo "🚀 Ready to push your changes!"
