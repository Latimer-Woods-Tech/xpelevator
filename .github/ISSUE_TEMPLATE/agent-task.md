---
name: Agent Task
about: Structured task for autonomous subagents (claude-code, sauna, etc.). Required for any work delegated to a subagent.
title: "[agent-task] "
labels: ["agent-task"]
assignees: []
---

<!--
This template is the contract every subagent reads before starting.
Fill every section. Empty sections = ambiguous task = wasted run.
See .github/AGENT_PROTOCOL.md for the full coordination rules.
-->

## Outcome

<!-- What user-visible thing changes when this is done? One sentence. Concrete. -->

## Acceptance criteria

<!-- Checkboxes the agent (and reviewer) verify against. Be specific: "endpoint returns 200" not "endpoint works". -->

- [ ]
- [ ]
- [ ]

## Files in scope

<!-- Best-guess list of files the agent will touch. Surfaces conflicts with parallel work. "TBD" is acceptable but discouraged. -->

-

## Files explicitly out of scope

<!-- Anything the agent must NOT modify. Routing tables, schema files, public APIs unless explicitly listed in scope. -->

-

## Tests required

<!-- Which tests must run + pass before posting state:done. Default: full deterministic suite + any contract tests for the touched layer. -->

- `npm run test:deterministic`
-

## Dependencies / blocks

<!-- Other issue numbers that must land first. Or external blockers (Stripe config, secret, design decision). -->

-

## Estimated complexity

<!-- One of: trivial (<30 min), small (<2h), medium (<1 day), large (split into multiple issues). -->

complexity:

## Done means

<!-- Final check: agent has posted `/status state:done`, all tests green, PR opened against main (or integration/<sprint> for parallel batches), references this issue. -->

- [ ] PR opened referencing this issue
- [ ] `/status state:done` posted with `tests: passing=true`
- [ ] Coordinator/reviewer verified before merge
