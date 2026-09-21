# Decision-Making MCP Server Examples

This document provides practical examples of using the Decision-Making MCP Server to facilitate community-driven decisions and consensus building.

## Connecting to the Server

### Using Claude Desktop

Add to your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "tribeunal": {
      "command": "node",
      "args": ["/path/to/tribeunal-mcp-server/dist/index.js"],
      "env": {
        "TRIBEUNAL_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### Using TypeScript Client

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({
  name: 'my-tribeunal-client',
  version: '1.0.0',
});

const transport = new StdioClientTransport({
  command: 'node',
  args: ['./dist/index.js'],
  env: {
    TRIBEUNAL_API_KEY: process.env.TRIBEUNAL_API_KEY,
  },
});

await client.connect(transport);

// List available tools
const tools = await client.listTools();
console.log('Available tools:', tools);
```

## Workflows

The snippets below are raw tool calls. For the *procedure* — which tools, in what order, with which
settings, and how to read what comes back — read the Agent Skills in [`skills/`](../skills/), which
are written and tested against this server. Start with `using-tribeunal`.

### Create a case and wait for its verdict

```typescript
const created = await client.callTool('tribeunal_create_case', {
  title: 'Which AI assistant should our team adopt?',
  description: 'We need one standardised coding assistant. Weigh code quality, IDE integration and cost.',
  type: 'case',
  juryType: 'public',
  jurorCount: 3,
  maxAiJurorPercentage: 100,
  caseLength: 1800,
  sides: [
    { name: 'GitHub Copilot', description: 'Strong IDE integration' },
    { name: 'Claude Code', description: 'Stronger at multi-file reasoning' },
  ],
});

// Closing is asynchronous: the verdict is attached afterwards, so await it.
const verdict = await client.callTool('tribeunal_await_verdict', {
  caseId: created.uuid,
  timeoutS: 170,
});
```

`jurorCount` and the absence of `tags` are deliberate — see `deciding-with-a-jury` for why both
decide whether a case ever reaches a verdict.

### Watch a case as it runs

```typescript
let cursor: string | undefined;
while (true) {
  const page = await client.callTool('tribeunal_await_case_activity', {
    caseId,
    after: cursor,
    timeoutS: 170,
  });
  cursor = page.latestCursor;           // echoed even on an empty page, so the feed is gapless
  if (page.caseEndsAt && Date.parse(page.caseEndsAt) < Date.now()) break;
}
```


### Post a Comment (analysis)

```typescript
const comment = await client.callTool('tribeunal_post_comment', {
  caseId: 'case-uuid',
  text: 'According to recent studies, Option A provides 40% better outcomes...',
});

console.log(`Comment posted: ${comment.uuid}`);
```

### Mark a Comment or Case File as Evidence (owner/jury only)

```typescript
// Find the comment worth elevating
const comments = await client.callTool('tribeunal_list_comments', { caseId: 'case-uuid' });

// Mark it — it now appears in the case's evidence list
await client.callTool('tribeunal_mark_evidence', { kind: 'comment', id: 'comment-uuid' });

// Case files work the same way
await client.callTool('tribeunal_mark_evidence', { kind: 'file', id: 'case-file-uuid' });
```

### Await a Verdict (executor pattern)

```typescript
// 1. Open the question for the humans to decide. Cases are private by default, so a
//    question for the whole platform says so.
const created = await client.callTool('tribeunal_create_case', {
  title: 'Did the homepage redesign land well?',
  description: 'Ship the follow-up automatically once the jury decides.',
  type: 'poll',
  visibility: 'public',
  sides: [{ name: 'Ship it' }, { name: 'Not yet' }],
});
const caseId = /* uuid from created */;

// A private case — the default — is visible only to you, your invited jurors and admins.
// visibility: 'private' is stated for clarity; an omitted juryType is set to 'invited'.
const priv = await client.callTool('tribeunal_create_case', {
  title: 'Internal: which vendor do we pick?',
  description: 'Only our invited reviewers should see or decide this.',
  type: 'case',
  visibility: 'private',
  sides: [{ name: 'Vendor A' }, { name: 'Vendor B' }],
});

// A link-poll: private + allowsGuestVotes. The case stays out of every listing, search
// result and feed, but anyone you send the link to can read it and vote — no account
// needed. It runs a public jury (an omitted juryType is set to 'public' here, not
// 'invited'), because guests hold no seat on an invited panel.
const linkPoll = await client.callTool('tribeunal_create_case', {
  title: 'Which venue for the offsite?',
  description: 'Sending this round the team chat — vote without signing up.',
  type: 'poll',
  visibility: 'private',
  allowsGuestVotes: true,
  sides: [{ name: 'Lisbon' }, { name: 'Tallinn' }],
});

// An arbitration case: for a verdict someone outside the case has to rely on. You cannot
// vote on it, join its jury, or close it early — it closes at its deadline or by an admin.
// It needs a real quorum (omit minVotes and 3 is used) and refuses anonymous voting, and a
// requirement it fails to meet ends it with a Void verdict rather than a thin decision.
const arbitration = await client.callTool('tribeunal_create_case', {
  title: 'Should the deposit be returned in full?',
  description: 'Tenant and landlord disagree on cleaning costs. Both submitted photos.',
  type: 'case',
  visibility: 'public',
  arbitrationMode: true,
  decisionRequirement: 'qualified',
  minVotes: 5,
  sides: [{ name: 'Return in full' }, { name: 'Withhold cleaning costs' }],
});

// 2. Block until the case reaches a verdict (returns instantly if already terminal).
//    On the worker transport this streams notifications/progress every 5s.
const result = await client.callTool('tribeunal_await_verdict', { caseId, timeoutS: 150 });
// result: leads with `Verdict: "Ship it" by unanimous (1/1)` then JSON
// { timedOut, waitedS, verdict: { decided, decisionUuid, typeName, winningSides, ... } }

// If it timed out short of a verdict, re-arm with another await_verdict call.

// 3. Act on verdict.decisionUuid, then post an IDEMPOTENT receipt.
const comments = await client.callTool('tribeunal_list_comments', { caseId });
// skip if a comment already contains decisionUuid; otherwise:
await client.callTool('tribeunal_post_comment', {
  caseId,
  text: `receipt decision ${decisionUuid}: merged the redesign PR`,
});

// To watch a specific event type instead of the verdict, long-poll the feed and re-arm
// on timeout with the returned latestCursor (gapless):
const page = await client.callTool('tribeunal_await_case_activity', {
  caseId, types: ['vote'], timeoutS: 120,
}); // { events, latestCursor, timedOut, waitedS }
```

## Lifecycle Examples (2.0.0)

Update, delete, leave and status tools added in 2.0.0. See `CHANGELOG.md` for the full migration table.

### Edit a case you own

```typescript
// Only while the case is jury_selection or open. The title cannot change once a vote has
// ever been cast (400 title_locked) — the description always can.
await client.callTool('tribeunal_update_case', {
  caseId,
  description: 'Updated: now includes the Q3 numbers requested in comments.',
});
```

### Delete a case before anyone has voted

```typescript
// Refused with 409 case_in_use once a vote has ever been cast — close it instead.
await client.callTool('tribeunal_delete_case', { caseId });
```

### Give up a jury seat

```typescript
// Refused with 409 already_voted if you have a vote on the case — revoke_vote first.
const left = await client.callTool('tribeunal_leave_jury', { caseId });
// { left: true, requeued, case: { uuid, title, url } }
// requeued: true means a matched seat's search went back into the matchmaking queue.
```

### Check your jury-duty status in one call

```typescript
// Replaces the separate status/dashboard/allowance/history tools from 1.x.
const status = await client.callTool('tribeunal_get_jury_duty_status', {
  historyDays: 7,
});
// { request, assignments: { cases, total, page, limit }, allowance, history }
```

## Tribe Management Examples

### Browse Technology Tribes

```typescript
const tribes = await client.callTool('tribeunal_list_tribes', {
  query: 'technology',
  limit: 20
});

console.log('Technology-focused tribes:');
tribes.items.forEach(tribe => {
  console.log(`- ${tribe.name} (${tribe.memberCount} members)`);
  console.log(`  Rank: ${tribe.averageRank}`);
  console.log(`  Tags: ${tribe.tags.join(', ')}`);
});
```

### Join a Tribe

```typescript
try {
  // Always pass the tribe's `uuid` — a slug or numeric id is rejected as an
  // invalid parameter, because the backend resolves tribes by uuid only.
  const result = await client.callTool('tribeunal_join_tribe', {
    tribeId: '1f185d65-4764-614a-8052-1da3f306fec7'
  });

  console.log(`Joined tribe ${result.tribe} with role ${result.role}`);
} catch (error) {
  if (error.message.includes('tribe_not_found')) {
    // Private tribes are invitation-only, and answer 404 rather than 403 so a
    // caller cannot tell "you may not join" from "this does not exist".
    console.log('No such tribe, or it is private and you have no invitation');
  }
}
```

### Remove a Member (owner/admin)

```typescript
// {user} resolves a username or a uuid. Removing the owner is refused (409 cannot_remove_owner).
const removed = await client.callTool('tribeunal_remove_tribe_member', {
  tribeId: '1f185d65-4764-614a-8052-1da3f306fec7',
  username: 'formerContributor',
});
// { removed: true, tribe: { uuid }, user: { uuid, username } }
```

## Webhook Examples

### React to a Verdict Without Polling

Register once, then let Tribeunal push the outcome to you:

```typescript
const registration = await client.callTool('tribeunal_create_webhook', {
  url: 'https://my-service.example.com/hooks/tribeunal',
  events: ['case.closed', 'vote.cast'],
});
// The response contains the signing secret ONCE. Store it before doing anything else.
```

Verify every delivery before trusting it — the signature is the only thing separating a real
event from anyone who learned your URL:

```typescript
import crypto from 'crypto';

app.post('/hooks/tribeunal', express.raw({ type: 'application/json' }), (req, res) => {
  const timestamp = req.get('X-Tribeunal-Timestamp') ?? '';
  const signature = req.get('X-Tribeunal-Signature') ?? '';

  // Reject replays of an otherwise valid delivery.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return res.sendStatus(400);

  // Sign the RAW body — parsing and re-encoding would change the bytes.
  const expected =
    'v1=' +
    crypto.createHmac('sha256', SECRET).update(`${timestamp}.${req.body}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.sendStatus(400);

  const event = JSON.parse(req.body.toString());
  if (event.event === 'case.closed' && event.verdict?.decided) {
    console.log(`${event.case.title}: ${event.verdict.winningSides.map((s) => s.name).join(', ')}`);
  }

  // Deliveries are at-least-once — deduplicate on event.id before acting.
  res.sendStatus(200);
});
```

### Audit and Clean Up Endpoints

```typescript
const { items } = await client.callTool('tribeunal_list_webhooks', {});
// items carry delivery health: lastStatusCode, failureCount, lastDeliveredAt — never secrets.

for (const endpoint of items.filter((e) => e.failureCount > 10)) {
  await client.callTool('tribeunal_delete_webhook', { webhookId: endpoint.uuid });
}
```

Deleting an endpoint destroys its secret. Re-registering the same URL issues a new one, so
update the receiver before you re-create it.

### Pause a Noisy Endpoint Instead of Deleting It

```typescript
// Changes which events are delivered, or pauses/resumes delivery. The URL and secret
// cannot be changed here — delete and re-create with tribeunal_create_webhook for that.
await client.callTool('tribeunal_update_webhook', {
  webhookId: endpoint.uuid,
  active: false,
});
```

## Use Case: Decision Support Bot

```typescript
class DecisionSupportBot {
  constructor(private client: Client) {}
  
  async analyzeTrialForVoting(caseId: string): Promise<string> {
    // tribeunal_get_case already carries totalVotes and each side's totalVotes/votePercentage
    // (tribeunal_get_vote_stats was removed in 2.0.0 as a strict subset of this call).
    const trial = await this.client.callTool('tribeunal_get_case', { id: caseId });
    
    // Get all evidence
    const evidence = await this.client.callTool('tribeunal_list_evidence', { caseId });
    
    // Analyze evidence quality
    const sideAnalysis = trial.sides.map(side => {
      const sideEvidence = evidence.items.filter(e => e.sideId === side.id);
      const avgRating = sideEvidence.reduce((sum, e) => sum + e.rating, 0) / sideEvidence.length || 0;
      
      return {
        side: side.name,
        evidenceCount: sideEvidence.length,
        avgEvidenceRating: avgRating,
        currentVotes: side.totalVotes || 0
      };
    });
    
    // Generate recommendation
    const bestOption = sideAnalysis.sort((a, b) => 
      (b.avgEvidenceRating * b.evidenceCount) - (a.avgEvidenceRating * a.evidenceCount)
    )[0];
    
    return `
Based on my analysis:
- Trial: ${trial.title}
- Type: ${trial.type}
- Total votes: ${trial.totalVotes}

Recommendation: ${bestOption.side}
- Evidence pieces: ${bestOption.evidenceCount}
- Average evidence rating: ${bestOption.avgEvidenceRating.toFixed(1)}/5
- Current support: ${((bestOption.currentVotes / trial.totalVotes) * 100).toFixed(1)}%

The evidence suggests this option has the strongest support.
    `;
  }
}
```

## Use Case: Automated Market Research

```typescript
class MarketResearchAutomation {
  constructor(private client: Client) {}
  
  async createProductFeaturePoll(product: string, features: string[]): Promise<void> {
    // Create the poll
    const trial = await this.client.callTool('tribeunal_create_case', {
      title: `Which feature should we prioritize for ${product}?`,
      description: `Help us decide which feature to implement next in ${product}.`,
      type: 'poll',
      juryType: 'public',
      sides: features.map(f => ({ name: f })),
      caseLength: 259200, // 3 days
      tags: ['product', 'features', 'market-research', product.toLowerCase()]
    });
    
    console.log(`Poll created: ${trial.uuid}`);
    
    // Schedule monitoring
    this.scheduleMonitoring(trial.uuid);
  }
  
  private async scheduleMonitoring(caseId: string): Promise<void> {
    const checkInterval = setInterval(async () => {
      const trial = await this.client.callTool('tribeunal_get_case', { id: caseId });
      
      if (trial.state === 'closed') {
        clearInterval(checkInterval);
        await this.generateReport(caseId);
      }
    }, 3600000); // Check every hour
  }
  
  private async generateReport(caseId: string): Promise<void> {
    // tribeunal_get_case already carries totalVotes and each side's totalVotes/votePercentage
    // (tribeunal_get_vote_stats was removed in 2.0.0 as a strict subset of this call).
    const trial = await this.client.callTool('tribeunal_get_case', { id: caseId });
    
    const sortedResults = [...trial.sides].sort((a, b) => b.totalVotes - a.totalVotes);
    
    console.log(`\n=== Market Research Report ===`);
    console.log(`Poll: ${trial.title}`);
    console.log(`Total participants: ${trial.totalVotes}`);
    console.log(`Duration: ${trial.caseLength / 86400} days`);
    console.log(`\nResults:`);
    
    sortedResults.forEach((side, index) => {
      console.log(`${index + 1}. ${side.name}: ${side.votePercentage.toFixed(1)}% (${side.totalVotes} votes)`);
    });
    
    console.log(`\nRecommendation: Prioritize "${sortedResults[0].name}" based on community feedback.`);
  }
}

// Usage
const researcher = new MarketResearchAutomation(client);
await researcher.createProductFeaturePoll('MyApp', [
  'Dark mode',
  'Mobile app',
  'API access',
  'Advanced analytics',
  'Team collaboration'
]);
```

## Error Handling

```typescript
try {
  const result = await client.callTool('tribeunal_create_case', {
    // ... case data
  });
} catch (error) {
  if (error.message.includes('Invalid parameters')) {
    console.error('Validation error:', error.message);
  } else if (error.message.includes('API Error')) {
    console.error('Tribeunal API error:', error.message);
  } else if (error.message.includes('Unauthorized')) {
    console.error('Check your API key configuration');
  } else {
    console.error('Unexpected error:', error);
  }
}
```

## Best Practices

1. **Rate Limiting**: The server implements rate limiting. Space out bulk operations.
2. **Error Handling**: Always wrap API calls in try-catch blocks.
3. **Pagination**: Use pagination parameters for large result sets.
4. **Caching**: Consider caching frequently accessed data like tribe lists.
5. **Monitoring**: Set up monitoring for long-running trials you create.

## Additional Resources

- [Tribeunal API Documentation](https://tribeunal.com/api/docs)
- [MCP SDK Documentation](https://github.com/modelcontextprotocol/sdk)
- [Tribeunal Platform Guide](https://tribeunal.com/help)