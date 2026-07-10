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

## Decision-Making Examples

### Find Active Decisions

```typescript
const activeDecisions = await client.callTool('decision_find_active', {
  status: 'open',
  decisionType: 'poll',
  tags: ['technology', 'ai'],
  limit: 10
});

console.log(`Found ${activeDecisions.total} active decisions`);
activeDecisions.items.forEach(decision => {
  console.log(`- ${decision.title} (${decision.voteCount} participants)`);
});
```

### Start a Product Decision Process

```typescript
const newDecision = await client.callTool('decision_start_process', {
  title: 'Which AI assistant should our team adopt for development?',
  description: 'We need to decide on a standardized AI coding assistant for our development team. Consider factors like code quality, integration, cost, and team preferences.',
  decisionType: 'case',
  participationType: 'public',
  options: [
    { 
      name: 'GitHub Copilot', 
      description: 'Microsoft/OpenAI powered assistant with excellent IDE integration' 
    },
    { 
      name: 'Claude', 
      description: 'Anthropic\'s AI assistant with strong reasoning capabilities' 
    },
    { 
      name: 'ChatGPT Plus', 
      description: 'OpenAI\'s conversational AI with coding capabilities' 
    },
    { 
      name: 'Keep Current Setup', 
      description: 'Continue with individual developer preferences' 
    }
  ],
  timeframe: 604800, // 7 days
  consensusRequired: 'simple_majority',
  categories: ['ai', 'development', 'tools', 'productivity'],
  template: 'business_choice'
});

console.log(`Decision process started: ${newDecision.uuid}`);
console.log(`Participate at: ${newDecision.url}`);
```

### Monitor Decision Progress

```typescript
async function monitorDecision(decisionId: string) {
  const decision = await client.callTool('decision_get_status', { id: decisionId });
  const consensus = await client.callTool('decision_check_consensus', { decisionId });
  
  console.log(`Decision: ${decision.title}`);
  console.log(`Status: ${decision.status}`);
  console.log(`Time remaining: ${decision.timeRemaining}`);
  console.log('\nCurrent consensus:');
  
  consensus.sides.forEach(side => {
    const percentage = (side.voteCount / consensus.totalVotes * 100).toFixed(1);
    console.log(`  ${side.name}: ${side.voteCount} participants (${percentage}%)`);
  });
  
  // Check if consensus is reached
  if (consensus.consensusReached) {
    console.log(`\n✅ Consensus reached! Winner: ${consensus.winningOption}`);
  }
}

// Monitor every 5 minutes
setInterval(() => monitorDecision('decision-uuid-here'), 5 * 60 * 1000);
```

## Participation Examples

### Make Your Choice

```typescript
const decision = await client.callTool('decision_get_status', { 
  id: 'decision-uuid' 
});

// Find the option you prefer
const preferredOption = decision.options.find(opt => opt.name === 'GitHub Copilot');

if (preferredOption) {
  const choice = await client.callTool('decision_choose_option', {
    decisionId: decision.id,
    optionId: preferredOption.id,
    reasoning: 'Based on our current IDE setup and team familiarity, Copilot offers the best integration and immediate productivity gains.'
  });
  
  console.log('Choice recorded successfully!');
  console.log(`Your reasoning has been saved and will help others understand your perspective.`);
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
// 1. Open the question for the humans to decide.
const created = await client.callTool('tribeunal_create_case', {
  title: 'Did the homepage redesign land well?',
  description: 'Ship the follow-up automatically once the jury decides.',
  type: 'poll',
  sides: [{ name: 'Ship it' }, { name: 'Not yet' }],
});
const caseId = /* uuid from created */;

// A private case is visible only to you, your invited jurors and admins. Pass
// visibility: 'private'; an omitted juryType is set to 'invited' automatically.
const priv = await client.callTool('tribeunal_create_case', {
  title: 'Internal: which vendor do we pick?',
  description: 'Only our invited reviewers should see or decide this.',
  type: 'case',
  visibility: 'private',
  sides: [{ name: 'Vendor A' }, { name: 'Vendor B' }],
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
  const result = await client.callTool('tribeunal_join_tribe', {
    tribeId: 'ai-researchers-tribe'
  });
  
  console.log(`Successfully joined ${result.tribeName}!`);
  console.log(`Your rank: ${result.memberRank}`);
} catch (error) {
  if (error.message.includes('tokens')) {
    console.log('Insufficient tokens to join this tribe');
  }
}
```

## Use Case: Decision Support Bot

```typescript
class DecisionSupportBot {
  constructor(private client: Client) {}
  
  async analyzeTrialForVoting(caseId: string): Promise<string> {
    // Get trial details
    const trial = await this.client.callTool('tribeunal_get_case', { id: caseId });
    
    // Get all evidence
    const evidence = await this.client.callTool('tribeunal_list_evidence', { caseId });
    
    // Get current voting statistics
    const stats = await this.client.callTool('tribeunal_get_vote_stats', { caseId });
    
    // Analyze evidence quality
    const sideAnalysis = trial.sides.map(side => {
      const sideEvidence = evidence.items.filter(e => e.sideId === side.id);
      const avgRating = sideEvidence.reduce((sum, e) => sum + e.rating, 0) / sideEvidence.length || 0;
      
      return {
        side: side.name,
        evidenceCount: sideEvidence.length,
        avgEvidenceRating: avgRating,
        currentVotes: stats.sides.find(s => s.id === side.id)?.voteCount || 0
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
- Total votes: ${stats.totalVotes}

Recommendation: ${bestOption.side}
- Evidence pieces: ${bestOption.evidenceCount}
- Average evidence rating: ${bestOption.avgEvidenceRating.toFixed(1)}/5
- Current support: ${((bestOption.currentVotes / stats.totalVotes) * 100).toFixed(1)}%

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
    const trial = await this.client.callTool('tribeunal_create_trial', {
      title: `Which feature should we prioritize for ${product}?`,
      description: `Help us decide which feature to implement next in ${product}.`,
      type: 'poll',
      juryType: 'public',
      sides: features.map(f => ({ name: f })),
      trialLength: 259200, // 3 days
      tags: ['product', 'features', 'market-research', product.toLowerCase()]
    });
    
    console.log(`Poll created: ${trial.id}`);
    
    // Schedule monitoring
    this.scheduleMonitoring(trial.id);
  }
  
  private async scheduleMonitoring(caseId: string): Promise<void> {
    const checkInterval = setInterval(async () => {
      const trial = await this.client.callTool('tribeunal_get_case', { id: caseId });
      
      if (trial.status === 'closed') {
        clearInterval(checkInterval);
        await this.generateReport(caseId);
      }
    }, 3600000); // Check every hour
  }
  
  private async generateReport(caseId: string): Promise<void> {
    const trial = await this.client.callTool('tribeunal_get_case', { id: caseId });
    const stats = await this.client.callTool('tribeunal_get_vote_stats', { caseId });
    
    const sortedResults = stats.sides.sort((a, b) => b.voteCount - a.voteCount);
    
    console.log(`\n=== Market Research Report ===`);
    console.log(`Poll: ${trial.title}`);
    console.log(`Total participants: ${stats.totalVotes}`);
    console.log(`Duration: ${trial.trialLength / 86400} days`);
    console.log(`\nResults:`);
    
    sortedResults.forEach((side, index) => {
      const percentage = (side.voteCount / stats.totalVotes * 100).toFixed(1);
      console.log(`${index + 1}. ${side.name}: ${percentage}% (${side.voteCount} votes)`);
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
  const result = await client.callTool('tribeunal_create_trial', {
    // ... trial data
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

- [Tribeunal API Documentation](https://tribeunal.test/api/docs)
- [MCP SDK Documentation](https://github.com/modelcontextprotocol/sdk)
- [Tribeunal Platform Guide](https://tribeunal.com/help)