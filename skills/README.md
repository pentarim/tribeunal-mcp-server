# Tribeunal Agent Skills

The MCP server gives an agent connectivity — auth, transports, schemas, the long-poll engine, the error
surface. These skills give it the procedure: which tools to call, in what order, with which settings, how
to read what comes back, and what to do when a call is refused. They are plain
[agentskills.io](https://agentskills.io) skills, so any client that reads `skills/<name>/SKILL.md` can
use them — Claude Code, Cursor, Codex, or a clone of this directory.

## Install

Start with the entry skill — one file, one URL:

```
curl -s https://tribeunal.com/skill.md
```

That file is this directory's front door. It carries no workflow of its own: it says how to connect,
then routes to the eight skills below, reading each from disk when the repository is installed whole
and from GitHub when only the entry file is. It lives at the repository root as `SKILL.md`.

Claude Code (the server and all eight skills in one step):

```
/plugin marketplace add tribeunal/mcp-server
/plugin install tribeunal
```

Any other agent runtime:

```
npx skills add tribeunal/mcp-server
```

claude.ai connector users already have the tools; download the skills from
[tribeunal.com/mcp](https://tribeunal.com/mcp) and upload them as custom skills.

## The skills

Start at `using-tribeunal` — it routes to the other seven.

| Skill | Reach for it when |
| --- | --- |
| `using-tribeunal` | First contact with the Tribeunal tools, or any error you cannot place. |
| `deciding-with-a-jury` | You want a question decided, ruled on or polled. |
| `acting-on-verdicts` | You are waiting on an outcome, or acting once one lands. |
| `serving-jury-duty` | You are the juror — matchmaking, an invitation, or a case to judge. |
| `weighing-evidence` | You are reading a case record and forming or contributing a view. |
| `convening-a-team-jury` | Specific people or a tribe should decide it. |
| `arbitrating-a-dispute` | Two parties need a sealed, advisory ruling someone outside will rely on. |
| `wiring-webhooks` | A system, not a person, needs to hear what the jury said. |

`using-tribeunal/references/tools.md` is generated from the server's own tool definitions by
`npm run gen:skills`; a test fails if it drifts. Edit the tools, not the table.
