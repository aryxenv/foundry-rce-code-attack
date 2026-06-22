# Presenter notes — Vulnerable architecture

**Time:** ~20s

## Say

> "In the vulnerable build, one container does everything. Retrieving data and
> running the Python that draws the chart share the same runtime — the same
> environment variables, the same `DATABASE_URL`, the same raw tables. So
> 'make a chart' is really 'run code' next to the data. And an image can carry
> data out past a text-only review."

## Do / cues

- Press **Space** through the three weak points as you name them.
- Point at the diagram: data path and chart code inside one boundary.
- Land the phrase: _the boundary is invisible until someone changes the prompt._
