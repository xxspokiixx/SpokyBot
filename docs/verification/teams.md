# Teams and shared instructions

A team is a named membership group. It can be empty. Group chats are
conversations, and Templates is the catalog that creates new teams and bots.
The sidebar and Team map use the same persisted team list. Existing bot and
group-chat labels migrate automatically; clearing a team's shared instructions
or moving its last bot does not remove the team.

Run the isolated lifecycle checks:

```sh
pnpm exec vitest run server/team-lifecycle.e2e.test.ts server/section-context.test.ts server/store.test.ts src/lib/team-map.test.ts --maxWorkers=2
OMB_UI_E2E=1 pnpm exec vitest run scripts/testing/team-lifecycle-ui.e2e.test.ts scripts/testing/team-template-ui.e2e.test.ts --maxWorkers=1
```

The server test uses `launchVerificationServer`, sends a sample conversation,
creates an empty team, moves two existing bots, saves shared instructions,
empties and renames the team, imports a legacy template with a colliding name,
and restarts the exact disposable server. It checks retained instructions and
conversation messages, archived membership, rejected nonempty deletion and
explicit empty-team deletion. API requests and `control-omb` wait/messages
results are kept beside the fixture log in `*.team-lifecycle.json`.

The renderer test uses `control-omb ui launch`, opens **Create team**, leaves it
empty, moves two bots through Team map, edits shared instructions and reloads.
A second fixture client moves the bots out; live updates retain the empty team
and expose rename/delete. Rename preserves instructions; delete confirms that
the team's instructions will be removed. It captures
`.omb-scratch/verify-evidence/team-lifecycle.png` before deletion.

The owner API keeps the existing `/api/sidebar-sections` name for older clients:

- `GET` returns `{ sections: string[] }`.
- `POST { name, botIds?: string[] }` creates a named team or moves the supplied
  bots into it. Omitted/empty `botIds` creates an empty team. An empty name with
  selected bots moves them into General. Chief conflicts change no memberships.
- `PATCH ?section=NAME { name }` renames an empty team and its instructions.
- `DELETE ?section=NAME` removes an empty team and its instructions. Bots,
  archived bots and group chats must be moved out first.

The registry shares the atomic section-context file so rename/delete cannot
split a team's name from its instructions. Team labels are remembered before a
bot write; a storage failure may leave an empty team, but cannot partially move
the selected bots. This does not change bot communication permissions.

Both fixtures own their fake engine, temporary home and data directory. Cleanup
stops only their own child processes. Never run these requests against the live
app or copy live data into a fixture.
