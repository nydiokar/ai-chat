# Repository Guidelines

## Midn Orientation
Midn is the mindset for this repository: a deliberate, holistic, and forward-thinking way of building. It asks every contributor to look beyond the current ticket and consider the system, the user, and the long-term trajectory of the product.

## Whole-System Thinking
- Map the full loop: input → processing → tools → storage → outputs → feedback. Write down at least one upstream and downstream impact before you change a core flow.
- Treat Discord UX, MCP tools, data, and AI behavior as a single system, not isolated modules.

## Future-Facing Decisions
- Prefer extensible interfaces over quick shortcuts. If a change can generalize to new models, tools, or features, do it now.
- Document the “next obvious extension” in PRs (one bullet is enough). Example: “Add provider adapter for x; later enable model routing.”

## Depth Over Scope
- Go deeper in fewer places. A small, resilient capability beats a wide, fragile surface area.
- Use complexity budgets: if you add a new feature, remove or simplify one other piece when possible.

## Signals, Not Noise
- Use real signals to guide change: performance metrics, task completion rates, user feedback, and error logs.
- Before adding a new config flag, ask: does it simplify the mental model or just shift complexity?

## Long-View Collaboration
- Align on intent, not just implementation. Explain the “why” in docs and PRs.
- When unsure, choose the path that makes future contributions easier to reason about.

## Practical Habits
- Add a “System Impact” line in PR descriptions: “Impacts: memory, tool routing, task scheduling.”
- Keep an “Assumption” note when building on model behavior or vendor APIs.
- If a change seems small but touches core flows, request an extra review.
