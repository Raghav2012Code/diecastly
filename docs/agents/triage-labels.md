# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## An issue blocked on the environment is `ready-for-human`

The vocabulary has no "blocked" label, and the gap matters, because the wrong one sends someone into work that cannot succeed.

An issue that is **fully specified but cannot be executed on the current host** is `ready-for-human`, not `ready-for-agent` and not `needs-triage`. It needs a human because the environment itself has to be provisioned (a reachable server, a credential, a paid account), and because the work itself is judgement-heavy — triaging real test failures, or judging a page by eye.

The reasoning for each rejection:

- **`ready-for-agent`** is the dangerous one. An AFK agent handed a blocked issue will either fail repeatedly or, worse, write the test or the code and report it as done without ever having executed it. That is the exact failure this repo's rules about not claiming unrun work exist to prevent.
- **`needs-triage`** stops being true the moment the blocker has been identified and written down. Leaving an issue there after writing a comment that explains precisely why it cannot proceed is a board that lies about its own state.
- **`needs-info`** is for missing information about the *request*. A missing database is missing infrastructure, which is a different thing, and the reporter is not withholding anything.

Whichever label applies, the comment should state the blocker **specifically and verifiably** — the exact error, the exact command that fails — not "blocked on infrastructure". A future reader should be able to check the claim rather than take it on trust. See #19 and #20 for the pattern.
