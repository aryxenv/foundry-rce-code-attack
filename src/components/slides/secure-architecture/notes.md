# Presenter notes — Secure architecture

**Time:** ~20s

## Say

> "The fix isn't a better system prompt — it's what the code can _reach_.
> Generated code now runs in Foundry's Code Interpreter, in an isolated sandbox
> that doesn't inherit the agent's identity to reach the database. It still draws
> the chart, but it can't reach the raw customer rows, salaries, or SSNs."

## Do / cues

- Press **Space** through the three controls: Narrow tool → No inherited access →
  PII unreachable.
- Point at the diagram: the interpreter sits in its own sandbox, and the path
  to raw tables is cut.
- Set up the next demo: _same attacker, new boundary._
