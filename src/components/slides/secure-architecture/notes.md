# Presenter notes — Secure architecture

**Time:** ~20s

## Say

> "The fix isn't a better system prompt — it's what the code can _reach_. One
> narrow tool is the only path to the database. The agent pulls sanitized rows
> and hands only those to Foundry Code Interpreter. It runs in a sealed
> sandbox — it can still draw the chart, but it can't carry data back out."

## Do / cues

- Press **Space** through the three controls: Narrow tool → Sealed sandbox →
  Sanitized rows.
- Point at the diagram: the sandbox sits _outside_ the credential boundary and
  can't reach back in.
- Set up the next demo: _same attacker, new boundary._
