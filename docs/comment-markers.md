# Comment Markers

`local-board comment` can attach a small ordered set of structured key/value markers to a Run Log (or any section) comment. Markers are run-log annotations and grep aids: they make it easy to filter `Run Log` history for a step, an outcome, or an executor without parsing free-text prose.

## Not-evidence rule

**Markers are not routing or gate evidence.** The `completedSteps` and `gate:<stage>:...` front-matter tokens remain the only evidence ledger the workflow reads. `local-board state-report` does not read markers, `move`'s routing/gating checks do not read markers, and `validate` only checks marker *syntax*, never marker *semantics*. Adding `--marker outcome=PASS` to a comment has no effect on ticket state; it only changes what that one comment line looks like on disk.

## Syntax

CLI:

```sh
local-board comment T20260516T1539Z "Reviewed the diff." --marker step=implement --marker outcome=PASS --marker kind=specialty
```

`--marker key=value` is repeatable, order-preserving, and produces one rendered line:

```text
- 2026-07-08T20:24:37Z: [step:implement outcome:PASS kind:specialty] Reviewed the diff.
```

A comment with no `--marker` flags renders exactly as it always has:

```text
- 2026-07-08T20:24:37Z: Reviewed the diff.
```

Charsets:

- key: `^[A-Za-z0-9_.-]+$` (no whitespace, no `=`, `:`, `[`, `]`).
- value: `^[A-Za-z0-9_./-]+$`.

Duplicate keys in the same `comment` invocation are rejected (last-wins is not supported; the CLI errors instead of silently dropping input). A key or value outside the charset above is rejected with a non-zero exit and a message naming the offending flag.

**No quoting in v1.** Because values can never contain a space, `:`, `]`, or quote character, no quoting or escaping grammar exists. A value that would need quoting is a malformed-input error today; a future ticket may add quoting if there is demand.

## CLI-to-disk mapping

| CLI (`--marker`) | Rendered / on-disk |
|---|---|
| `key=value` | `key:value` |

The CLI accepts `=` because that mirrors other CLI flags; the rendered form uses `:` because pairs are space-joined inside a single `[...]` block and `:` reads naturally as "key: value" inside it.

## Reserved vocabulary

These keys are documented and validated for *syntax only* (charset, `key=value` shape); local-board does not check that their values come from a fixed enum. Other keys are allowed and pass syntax validation but are otherwise unvalidated.

| Key | Meaning |
|---|---|
| `kind` | The category of the comment, e.g. `mandatory`, `specialty`, `gate`, `human`, `orchestrator`. |
| `step` | The stage or step name the comment is about, e.g. `design`, `implement`, `security_audit`. |
| `outcome` | The result being logged, e.g. `PASS`, `CONCERNS`, `FAIL`, `INFO`. |
| `executor` | The executor route that produced the comment, e.g. `inline`, `claude-subagent-local-board-designer`. |

**Executor routes containing `:`.** Some executor route strings (e.g. `claude-subagent:local-board-designer`) contain a `:`, which the value charset above rejects — `:` is reserved as the marker `key:value` separator. Such a route cannot be recorded as-is in an `executor` marker value in v1. Either record the full route in the comment body text instead of a marker, or substitute a hyphenated shorthand (e.g. `claude-subagent-local-board-designer`) as the marker value.

## Round-trip and backward compatibility

`src/tickets.js` exports a pure `parseCommentLine(line)` that returns `{ timestamp, markers, body }`:

- A marked line parses back to its ordered markers and the trailing body text.
- A legacy unmarked comment (`- <ts>: some text`) parses to `markers: []` and the full text as `body` — existing Run Log history is unaffected by this feature.
- A line whose body happens to start with an unclosed `[` or a bracketed block that fails the marker grammar falls back gracefully: `markers: []`, and `body` is the whole remaining text (brackets included). `parseCommentLine` never throws.

## v1 limitations

- **No quoting.** Marker values are restricted to a charset that never needs escaping; there is no mechanism to embed spaces, colons, or brackets in a value.
- **Body/marker ambiguity.** An unmarked comment whose body legitimately starts with something that looks like a valid `[key:value ...]` block is indistinguishable, on parse, from a real marker block. This is rare in practice and is a known v1 limitation. `local-board validate`'s marker check is deliberately stricter than the parser (it only flags a bracketed block that contains at least one `key:value`-shaped token but fails the strict grammar), so it does not false-positive on ordinary prose that starts with a bracketed aside.

## Related

- [SKILL.md](../SKILL.md) - orchestrator runbook.
- [docs/TicketFormat.md](TicketFormat.md) - ticket file shape, including the Run Log section markers are appended to.
