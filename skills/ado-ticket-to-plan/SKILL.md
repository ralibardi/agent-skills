---
name: ado-ticket-to-plan
description: Builds an implementation plan from an Azure DevOps work item by retrieving ticket data (including image references), running one-question-at-a-time clarification in grill-me style, and producing a plan-mode-ready output. Use when the user mentions an ADO ticket/work item ID, asks to plan from a ticket, or asks to grill implementation choices from Azure DevOps context.
---

# ADO Ticket To Plan

## Quick start

When invoked, ask the user for a numeric Azure DevOps Work Item ID if one was not provided.

Example prompt:

`Create an implementation plan from ADO ticket 12345.`

## Workflow

1. Validate input
   - Accept only numeric Work Item IDs (for example `12345`).
   - If the ID is missing or not numeric, ask for a valid numeric ID before continuing.

2. Prepare MCP usage
   - Use the ADO MCP server only after reading the relevant tool schema/descriptor files.
   - If the server exposes `mcp_auth`, run authentication before using data-retrieval tools.
   - Do not guess tool arguments; follow the schema exactly.

3. Retrieve complete ticket context
   - Pull the work item core fields (title, type, state, area, iteration, assignee, tags, history).
   - Pull description and discussion/comment threads.
   - Pull links, related items, and attachment metadata.
   - Capture image-bearing data from ticket HTML/markdown and attachment references so visual context is included in planning.

4. Normalize and summarize context
   - Organize findings into:
     - problem statement
     - acceptance criteria
     - constraints
     - dependencies
     - risks
     - open questions
   - Explicitly mark missing sections (for example, "acceptance criteria: missing").

5. Run the grill-with-docs skill

6. Produce implementation plan
   - Output a concise, actionable plan suitable for plan-mode confirmation.
   - Include:
     - scope and goals
     - ordered implementation steps
     - likely files/components to touch
     - verification and test strategy
     - assumptions and risks
   - Keep the plan proportional to ticket complexity.
   - End by asking the user to confirm the plan before implementation.

## Guardrails

- Personal use skill: keep this under `~/.agents/skills/ado-ticket-to-plan`.
- Do not start coding while in planning flow.
- Prefer evidence from ticket + codebase over assumptions.
