Improvements from light agent - https://github.com/wxai-space/LightAgent


Use LightAgent only as an architectural reference, not as a dependency.
Adopt its Tree-of-Thought pre-planning loop and integrate it into ai-service as an optional planning stage before tool selection.
Reuse its MCP auto-registration pattern to simplify the logic in tools/mcp/* and reduce LOC by collapsing redundant discovery and schema-conversion code.
Replace your current implicit tool-selection heuristics with LightAgent’s explicit “reflect-then-filter” cycle to stabilize reasoning.
Keep all existing task, memory, DI, and Discord layers; these are already superior to LightAgent’s internal abstractions.
Do not import or rewrite LightAgent’s run-loop; mirror only the planning and tool-filter logic inside your existing orchestrator.
Use LightAgent as a correctness baseline when debugging reasoning failures, not as the primary runtime engine.