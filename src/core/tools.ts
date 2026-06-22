import { z } from 'zod';
import { TribeunalAPIClient, TribeunalAPIError } from '../client/api-client.js';

// Import schemas from tools
import {
  FindActiveDecisionsSchema,
  GetDecisionStatusSchema,
  StartDecisionProcessSchema,
  GatherEvidenceSchema,
  // Backward compatibility aliases
  SearchTrialsSchema,
  GetTrialSchema,
  CreateTrialSchema,
  ListEvidenceSchema,
} from '../tools/trials.js';

import {
  ChooseOptionSchema,
  CheckConsensusSchema,
  ProvideSupportingInfoSchema,
  // Backward compatibility aliases
  CastVoteSchema,
  RevokeVoteSchema,
  GetVoteStatsSchema,
  SubmitEvidenceSchema,
  RateEvidenceSchema,
} from '../tools/votes.js';

import {
  ListTribesSchema,
  GetTribeSchema,
  JoinTribeSchema,
  LeaveTribeSchema,
  CreateTribeSchema,
} from '../tools/tribes.js';

import {
  GetUserSchema,
} from '../tools/users.js';

import {
  JuryDutyAcceptSchema,
  JuryDutyRejectSchema,
  JuryDutyHistorySchema,
} from '../tools/jury-duty.js';

/**
 * The canonical list of tool definitions advertised via `tools/list`.
 *
 * Extracted verbatim from the historical `setupTools()` in `src/server.ts` so
 * the stdio server and the Cloudflare worker advertise the SAME 32 tools.
 */
export const TOOL_DEFINITIONS = [
  // Decision-focused tools (primary interface) - PRIORITIZED FOR "DECIDE" PROMPTS
  {
    name: 'decision_start_process',
    description: 'Make decisions through structured community processes - perfect for any "decide" scenario. When you need to decide between options, choose alternatives, or make choices, this tool helps you decide by gathering community input and votes.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 3, maxLength: 200, description: 'Clear decision question or statement (e.g., "Should we decide on lunch at Italian or Mexican?")' },
        description: { type: 'string', minLength: 10, description: 'Context, background, and criteria for making this decision' },
        decisionType: { type: 'string', enum: ['case', 'advice', 'poll'], description: 'Decision binding level - case (binding community decision), advice (input for final decider), poll (opinion gathering)' },
        participationType: { type: 'string', enum: ['public', 'invited'], default: 'public', description: 'Who can participate - open to everyone or specific invitees only' },
        options: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Option or choice name for the decision' },
              description: { type: 'string', description: 'Details about this option and its implications' },
            },
            required: ['name'],
          },
          minItems: 2,
          maxItems: 10,
          description: 'Available options/choices for decision makers to select from',
        },
        timeframe: { type: 'number', minimum: 60, maximum: 2592000, default: 86400, description: 'Decision deadline in seconds (default: 1 day)' },
        consensusRequired: { type: 'string', enum: ['any_majority', 'simple_majority', 'qualified_majority', 'unanimous'], default: 'simple_majority', description: 'Consensus threshold needed to finalize the decision' },
        categories: { type: 'array', items: { type: 'string' }, description: 'Decision categories for organization and findability' },
        stakeholders: { type: 'array', items: { type: 'string' }, description: 'Specific people to invite for stakeholder input (emails or usernames)' },
        template: { type: 'string', enum: ['business_choice', 'technical_decision', 'policy_vote', 'priority_ranking', 'emergency_decision', 'custom'], default: 'custom', description: 'Pre-configured decision template' },
      },
      required: ['title', 'description', 'decisionType', 'options'],
    },
  },
  {
    name: 'decision_find_active',
    description: 'Decide by finding active community decisions requiring input and participation. Search for existing decisions to help you decide, or find similar decisions that have been made before.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search for decisions by topic, title, or description' },
        status: { type: 'string', enum: ['init', 'open', 'closed', 'expired', 'suspended'], description: 'Decision status - open for active decisions requiring input' },
        decisionType: { type: 'string', enum: ['case', 'advice', 'poll'], description: 'Decision type - case (binding jury decision), advice (input for final decider), poll (opinion gathering)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by decision categories or topics' },
        page: { type: 'number', minimum: 1, default: 1, description: 'Page number for pagination' },
        limit: { type: 'number', minimum: 1, maximum: 100, default: 20, description: 'Number of decisions to return per page' },
      },
    },
  },
  {
    name: 'decision_choose_option',
    description: 'Express your choice in an active decision with optional reasoning - helps you decide by casting your vote or preference',
    inputSchema: {
      type: 'object',
      properties: {
        decisionId: { type: 'string', description: 'Decision ID to express your choice in' },
        optionId: { type: 'string', description: 'Option/choice ID you are selecting as your preference' },
        reasoning: { type: 'string', description: 'Optional explanation for why you chose this option' },
      },
      required: ['decisionId', 'optionId'],
    },
  },
  {
    name: 'decision_get_status',
    description: 'Check status, progress, and current results of a specific decision to help you decide if more input is needed',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Decision ID or UUID to check status, progress, and current results' },
      },
      required: ['id'],
    },
  },
  {
    name: 'decision_check_consensus',
    description: 'Check current consensus, participation levels, and progress toward resolution to help finalize decisions',
    inputSchema: {
      type: 'object',
      properties: {
        decisionId: { type: 'string', description: 'Decision ID to check current consensus, participation levels, and progress toward resolution' },
      },
      required: ['decisionId'],
    },
  },
  {
    name: 'decision_gather_evidence',
    description: 'Gather all supporting evidence, arguments, and data for a decision to help you decide based on facts',
    inputSchema: {
      type: 'object',
      properties: {
        decisionId: { type: 'string', description: 'Decision ID to gather all supporting evidence, arguments, and data for' },
      },
      required: ['decisionId'],
    },
  },
  {
    name: 'decision_provide_info',
    description: 'Provide supporting information, evidence, or arguments for a decision to help others decide',
    inputSchema: {
      type: 'object',
      properties: {
        decisionId: { type: 'string', description: 'Decision ID to provide supporting information for' },
        content: { type: 'string', description: 'Supporting information, data, arguments, or evidence content' },
        infoType: { type: 'string', enum: ['text', 'link', 'image'], default: 'text', description: 'Type of supporting information' },
        supportsOption: { type: 'string', description: 'Optional: which specific option this information supports' },
      },
      required: ['decisionId', 'content'],
    },
  },

  // Legacy tools (backward compatibility)
  {
    name: 'tribeunal_search_trials',
    description: 'Search for trials on Tribeunal with various filters',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query for trial title or description' },
        status: { type: 'string', enum: ['init', 'open', 'closed', 'expired', 'suspended'], description: 'Trial status filter' },
        type: { type: 'string', enum: ['case', 'advice', 'poll'], description: 'Trial type filter' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
        page: { type: 'number', minimum: 1, default: 1, description: 'Page number for pagination' },
        limit: { type: 'number', minimum: 1, maximum: 100, default: 20, description: 'Number of results per page' },
      },
    },
  },
  {
    name: 'tribeunal_get_trial',
    description: 'Get detailed information about a specific trial',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Trial ID or UUID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'tribeunal_create_trial',
    description: 'Create a new trial on Tribeunal for community decision-making',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 3, maxLength: 200, description: 'Trial title' },
        description: { type: 'string', minLength: 10, description: 'Detailed description of the trial' },
        type: { type: 'string', enum: ['case', 'advice', 'poll'], description: 'Type of trial' },
        juryType: { type: 'string', enum: ['public', 'invited'], default: 'public', description: 'Who can participate' },
        sides: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Option/choice name' },
              description: { type: 'string', description: 'Optional description' },
            },
            required: ['name'],
          },
          minItems: 2,
          maxItems: 10,
          description: 'Available choices for voting',
        },
        trialLength: { type: 'number', minimum: 60, maximum: 2592000, default: 86400, description: 'Duration in seconds' },
        decisionRequirement: { type: 'string', enum: ['any_majority', 'simple_majority', 'qualified_majority', 'unanimous'], default: 'simple_majority' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
        invitedUsers: { type: 'array', items: { type: 'string' }, description: 'Users to invite (for invited jury type)' },
      },
      required: ['title', 'description', 'type', 'sides'],
    },
  },
  {
    name: 'tribeunal_list_evidence',
    description: 'Get all evidence submitted for a specific trial',
    inputSchema: {
      type: 'object',
      properties: {
        trialId: { type: 'string', description: 'Trial ID to get evidence for' },
      },
      required: ['trialId'],
    },
  },
  // Voting tools
  {
    name: 'tribeunal_cast_vote',
    description: 'Cast a vote on a trial for a specific side/option',
    inputSchema: {
      type: 'object',
      properties: {
        trialId: { type: 'string', description: 'Trial ID to vote on' },
        sideId: { type: 'string', description: 'Side/option ID to vote for' },
      },
      required: ['trialId', 'sideId'],
    },
  },
  {
    name: 'tribeunal_revoke_vote',
    description: 'Revoke a previously cast vote (penalties may apply)',
    inputSchema: {
      type: 'object',
      properties: {
        trialId: { type: 'string', description: 'Trial ID' },
        voteId: { type: 'string', description: 'Vote ID to revoke' },
      },
      required: ['trialId', 'voteId'],
    },
  },
  {
    name: 'tribeunal_get_vote_stats',
    description: 'Get real-time voting statistics for a trial',
    inputSchema: {
      type: 'object',
      properties: {
        trialId: { type: 'string', description: 'Trial ID to get voting statistics for' },
      },
      required: ['trialId'],
    },
  },
  {
    name: 'tribeunal_submit_evidence',
    description: 'Submit evidence to support or oppose a side in a trial',
    inputSchema: {
      type: 'object',
      properties: {
        trialId: { type: 'string', description: 'Trial ID to submit evidence for' },
        content: { type: 'string', description: 'Evidence content' },
        type: { type: 'string', enum: ['text', 'link', 'image'], default: 'text', description: 'Type of evidence' },
        sideId: { type: 'string', description: 'Optional side ID to support with this evidence' },
      },
      required: ['trialId', 'content'],
    },
  },
  {
    name: 'tribeunal_rate_evidence',
    description: 'Rate the quality of submitted evidence (1-5 stars)',
    inputSchema: {
      type: 'object',
      properties: {
        evidenceId: { type: 'string', description: 'Evidence ID to rate' },
        rating: { type: 'number', minimum: 1, maximum: 5, description: 'Rating from 1 to 5' },
      },
      required: ['evidenceId', 'rating'],
    },
  },
  // Tribe tools
  {
    name: 'tribeunal_list_tribes',
    description: 'Browse available tribes on Tribeunal',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query for tribe name or description' },
        page: { type: 'number', minimum: 1, default: 1, description: 'Page number for pagination' },
        limit: { type: 'number', minimum: 1, maximum: 100, default: 20, description: 'Number of results per page' },
      },
    },
  },
  {
    name: 'tribeunal_get_tribe',
    description: 'Get detailed information about a specific tribe including members and rank structure',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Tribe ID or slug' },
      },
      required: ['id'],
    },
  },
  {
    name: 'tribeunal_join_tribe',
    description: 'Join a tribe (may require tokens for membership fee)',
    inputSchema: {
      type: 'object',
      properties: {
        tribeId: { type: 'string', description: 'Tribe ID to join' },
      },
      required: ['tribeId'],
    },
  },
  {
    name: 'tribeunal_leave_tribe',
    description: 'Leave a tribe you are currently a member of',
    inputSchema: {
      type: 'object',
      properties: {
        tribeId: { type: 'string', description: 'Tribe ID to leave' },
      },
      required: ['tribeId'],
    },
  },
  {
    name: 'tribeunal_create_tribe',
    description: 'Create a new interest-based tribe (requires tokens)',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 3, maxLength: 100, description: 'Tribe name' },
        description: { type: 'string', minLength: 10, description: 'Tribe description' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
        isPublic: { type: 'boolean', default: true, description: 'Whether the tribe is publicly visible' },
        membershipFee: { type: 'number', minimum: 0, default: 0, description: 'Token fee required to join' },
      },
      required: ['name', 'description'],
    },
  },
  // User tools
  {
    name: 'tribeunal_get_user',
    description: 'Get public profile information for a specific user',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'User ID or username' },
      },
      required: ['id'],
    },
  },
  {
    name: 'tribeunal_get_current_user',
    description: 'Get profile information for the currently authenticated user',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  // Jury Duty tools
  {
    name: 'tribeunal_jury_duty_status',
    description: 'Get current jury duty request status, queue position, and whether user has an active search or assignment',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'tribeunal_jury_duty_allowance',
    description: 'Get daily jury duty allowance info — how many requests used/remaining today, active jury count vs limit, and reset time',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'tribeunal_jury_duty_dashboard',
    description: 'Get jury duty dashboard with current trial assignments (cases to vote on), allowance info, and active request status. Best tool for finding trials assigned to you.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'tribeunal_jury_duty_start',
    description: 'Start a jury duty search — join the matchmaking queue to be assigned to a trial needing jurors. Consumes 1 daily allowance.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'tribeunal_jury_duty_cancel',
    description: 'Cancel an active jury duty search request. Refunds daily allowance if cancelled on the same day.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'tribeunal_jury_duty_accept',
    description: 'Accept a jury duty assignment to serve on a specific trial',
    inputSchema: {
      type: 'object',
      properties: {
        memberId: { type: 'string', description: 'Member ID from the jury assignment' },
      },
      required: ['memberId'],
    },
  },
  {
    name: 'tribeunal_jury_duty_reject',
    description: 'Reject a jury duty assignment and return to the queue for a different trial',
    inputSchema: {
      type: 'object',
      properties: {
        memberId: { type: 'string', description: 'Member ID from the jury assignment' },
      },
      required: ['memberId'],
    },
  },
  {
    name: 'tribeunal_jury_duty_history',
    description: 'Get jury duty allowance usage history for the past N days (default 7, max 30)',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', minimum: 1, maximum: 30, default: 7, description: 'Number of days of history to retrieve' },
      },
    },
  },
] as const;

/** Shape of the value an MCP `tools/call` handler must return. */
export interface ToolCallResult {
  content: Array<{ type: 'text'; text: string }>;
  [key: string]: unknown;
}

/**
 * Dispatch a single tool call against an injected API client.
 *
 * This is the transport-agnostic heart of the server: the stdio `Server` and
 * the Cloudflare `McpAgent` both funnel calls here so the 32 tools behave
 * identically regardless of how the caller authenticated.
 */
export async function dispatchToolCall(
  apiClient: TribeunalAPIClient,
  toolName: string,
  args: unknown,
): Promise<ToolCallResult> {
  const params = (args ?? {}) as Record<string, unknown>;

  try {
    switch (toolName) {
      // Decision-focused tools (new)
      case 'decision_find_active': {
        const p = FindActiveDecisionsSchema.parse(params);
        const results = await apiClient.searchTrials({
          query: p.query,
          status: p.status,
          type: p.decisionType,
          tags: p.tags,
          page: p.page,
          limit: p.limit,
        });
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      }

      case 'decision_get_status': {
        const p = GetDecisionStatusSchema.parse(params);
        const trial = await apiClient.getTrial(p.id);
        return { content: [{ type: 'text', text: JSON.stringify(trial, null, 2) }] };
      }

      case 'decision_start_process': {
        const p = StartDecisionProcessSchema.parse(params);
        const trial = await apiClient.createTrial({
          title: p.title,
          description: p.description,
          type: p.decisionType,
          juryType: p.participationType,
          sides: p.options,
          trialLength: p.timeframe,
          decisionRequirement: p.consensusRequired,
          tags: p.categories,
        });
        return {
          content: [
            {
              type: 'text',
              text: `Decision process started successfully!

UUID: ${trial.uuid}
URL: ${trial.url || `https://tribeunal.test/cases/${trial.slug}`}

You can view and participate in the decision at: ${trial.url || `https://tribeunal.test/cases/${trial.slug}`}

Full response:
${JSON.stringify(trial, null, 2)}`,
            },
          ],
        };
      }

      case 'decision_choose_option': {
        const p = ChooseOptionSchema.parse(params);
        const result = await apiClient.castVote(p.decisionId, p.optionId);
        return {
          content: [
            {
              type: 'text',
              text: `Choice recorded successfully!${p.reasoning ? ` Reasoning: ${p.reasoning}` : ''}\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      case 'decision_check_consensus': {
        const p = CheckConsensusSchema.parse(params);
        const stats = await apiClient.getVoteStats(p.decisionId);
        return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
      }

      case 'decision_gather_evidence': {
        const p = GatherEvidenceSchema.parse(params);
        const evidence = await apiClient.getTrialEvidence(p.decisionId);
        return { content: [{ type: 'text', text: JSON.stringify(evidence, null, 2) }] };
      }

      case 'decision_provide_info': {
        const p = ProvideSupportingInfoSchema.parse(params);
        const evidence = await apiClient.submitEvidence(p.decisionId, {
          content: p.content,
          type: p.infoType,
          sideId: p.supportsOption,
        });
        return {
          content: [
            {
              type: 'text',
              text: `Supporting information submitted successfully!\n${JSON.stringify(evidence, null, 2)}`,
            },
          ],
        };
      }

      // Legacy trial tools (backward compatibility)
      case 'tribeunal_search_trials': {
        const p = SearchTrialsSchema.parse(params);
        const results = await apiClient.searchTrials(p);
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      }

      case 'tribeunal_get_trial': {
        const p = GetTrialSchema.parse(params);
        const trial = await apiClient.getTrial(p.id);
        return { content: [{ type: 'text', text: JSON.stringify(trial, null, 2) }] };
      }

      case 'tribeunal_create_trial': {
        const p = CreateTrialSchema.parse(params);
        const trial = await apiClient.createTrial(p);
        return {
          content: [
            {
              type: 'text',
              text: `Trial created successfully!

UUID: ${trial.uuid}
URL: ${trial.url || `https://tribeunal.test/cases/${trial.slug}`}

You can view and share the trial at: ${trial.url || `https://tribeunal.test/cases/${trial.slug}`}

Full response:
${JSON.stringify(trial, null, 2)}`,
            },
          ],
        };
      }

      case 'tribeunal_list_evidence': {
        const p = ListEvidenceSchema.parse(params);
        const evidence = await apiClient.getTrialEvidence(p.trialId);
        return { content: [{ type: 'text', text: JSON.stringify(evidence, null, 2) }] };
      }

      // Vote tools
      case 'tribeunal_cast_vote': {
        const p = CastVoteSchema.parse(params);
        const result = await apiClient.castVote(p.trialId, p.sideId);
        return {
          content: [
            { type: 'text', text: `Vote cast successfully!\n${JSON.stringify(result, null, 2)}` },
          ],
        };
      }

      case 'tribeunal_revoke_vote': {
        const p = RevokeVoteSchema.parse(params);
        const result = await apiClient.revokeVote(p.trialId, p.voteId);
        return {
          content: [
            {
              type: 'text',
              text: `Vote revoked successfully. Note: Penalties may apply.\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      case 'tribeunal_get_vote_stats': {
        const p = GetVoteStatsSchema.parse(params);
        const stats = await apiClient.getVoteStats(p.trialId);
        return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
      }

      case 'tribeunal_submit_evidence': {
        const p = SubmitEvidenceSchema.parse(params);
        const evidence = await apiClient.submitEvidence(p.trialId, {
          content: p.content,
          type: p.type,
          sideId: p.sideId,
        });
        return {
          content: [
            { type: 'text', text: `Evidence submitted successfully!\n${JSON.stringify(evidence, null, 2)}` },
          ],
        };
      }

      case 'tribeunal_rate_evidence': {
        const p = RateEvidenceSchema.parse(params);
        const result = await apiClient.rateEvidence(p.evidenceId, p.rating);
        return {
          content: [
            { type: 'text', text: `Evidence rated successfully!\n${JSON.stringify(result, null, 2)}` },
          ],
        };
      }

      // Tribe tools
      case 'tribeunal_list_tribes': {
        const p = ListTribesSchema.parse(params);
        const tribes = await apiClient.listTribes(p);
        return { content: [{ type: 'text', text: JSON.stringify(tribes, null, 2) }] };
      }

      case 'tribeunal_get_tribe': {
        const p = GetTribeSchema.parse(params);
        const tribe = await apiClient.getTribe(p.id);
        return { content: [{ type: 'text', text: JSON.stringify(tribe, null, 2) }] };
      }

      case 'tribeunal_join_tribe': {
        const p = JoinTribeSchema.parse(params);
        const result = await apiClient.joinTribe(p.tribeId);
        return {
          content: [
            { type: 'text', text: `Successfully joined tribe!\n${JSON.stringify(result, null, 2)}` },
          ],
        };
      }

      case 'tribeunal_leave_tribe': {
        const p = LeaveTribeSchema.parse(params);
        const result = await apiClient.leaveTribe(p.tribeId);
        return {
          content: [
            { type: 'text', text: `Successfully left tribe.\n${JSON.stringify(result, null, 2)}` },
          ],
        };
      }

      case 'tribeunal_create_tribe': {
        const p = CreateTribeSchema.parse(params);
        const tribe = await apiClient.createTribe({
          name: p.name,
          description: p.description,
          tags: p.tags,
        });
        return {
          content: [
            {
              type: 'text',
              text: `Tribe created successfully! Note: Creating tribes requires tokens.\n${JSON.stringify(tribe, null, 2)}`,
            },
          ],
        };
      }

      // User tools
      case 'tribeunal_get_user': {
        const p = GetUserSchema.parse(params);
        const user = await apiClient.getUser(p.id);
        return { content: [{ type: 'text', text: JSON.stringify(user, null, 2) }] };
      }

      case 'tribeunal_get_current_user': {
        const user = await apiClient.getCurrentUser();
        return { content: [{ type: 'text', text: JSON.stringify(user, null, 2) }] };
      }

      // Jury Duty tools
      case 'tribeunal_jury_duty_status': {
        const status = await apiClient.getJuryDutyStatus();
        return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
      }

      case 'tribeunal_jury_duty_allowance': {
        const allowance = await apiClient.getJuryDutyAllowance();
        return {
          content: [
            {
              type: 'text',
              text: `Jury Duty Allowance:\nDaily: ${allowance.allowance?.used_today ?? '?'}/${allowance.allowance?.daily_max ?? '?'} used (${allowance.allowance?.remaining_today ?? '?'} remaining)\nActive Juries: ${allowance.allowance?.active_jury_duties ?? '?'}/${allowance.allowance?.max_active_jury_duties ?? '?'}\nCan Start: ${allowance.allowance?.can_use ? 'Yes' : 'No'}\nResets: ${allowance.allowance?.reset_time ?? 'midnight'}\n\n${JSON.stringify(allowance, null, 2)}`,
            },
          ],
        };
      }

      case 'tribeunal_jury_duty_dashboard': {
        const dashboard = await apiClient.getJuryDutyDashboard();
        const assignments = dashboard.current_assignments || [];
        const total = dashboard.assignments_total || 0;
        return {
          content: [
            {
              type: 'text',
              text: `Jury Duty Dashboard:\nTotal Assignments: ${total}\nShowing: ${assignments.length} recent assignments\nActive Request: ${dashboard.active_request ? 'Yes (status: ' + dashboard.active_request.status + ')' : 'None'}\n\nAllowance:\n  Daily: ${dashboard.allowance?.used_today ?? '?'}/${dashboard.allowance?.daily_max ?? '?'} (${dashboard.allowance?.remaining_today ?? '?'} remaining)\n  Active Juries: ${dashboard.allowance?.active_jury_duties ?? '?'}/${dashboard.allowance?.max_active_jury_duties ?? '?'}\n\n${JSON.stringify(dashboard, null, 2)}`,
            },
          ],
        };
      }

      case 'tribeunal_jury_duty_start': {
        const result = await apiClient.startJuryDuty();
        return {
          content: [
            {
              type: 'text',
              text: `Jury duty request created!\nStatus: ${result.request?.status || 'waiting'}\nAllowance Remaining: ${result.allowance?.remaining_today ?? '?'}\n\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      case 'tribeunal_jury_duty_cancel': {
        const result = await apiClient.cancelJuryDuty();
        return {
          content: [
            {
              type: 'text',
              text: `Jury duty request cancelled. Allowance refunded (if same day).\n\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      case 'tribeunal_jury_duty_accept': {
        const p = JuryDutyAcceptSchema.parse(params);
        const result = await apiClient.acceptJuryDuty(p.memberId);
        return {
          content: [
            {
              type: 'text',
              text: `Jury duty accepted! Trial: ${result.trial?.title || 'Unknown'}\nURL: ${result.trial?.url || 'N/A'}\n\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      case 'tribeunal_jury_duty_reject': {
        const p = JuryDutyRejectSchema.parse(params);
        const result = await apiClient.rejectJuryDuty(p.memberId);
        return {
          content: [
            {
              type: 'text',
              text: `Jury duty rejected. Searching for another case...\n\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      case 'tribeunal_jury_duty_history': {
        const p = JuryDutyHistorySchema.parse(params);
        const history = await apiClient.getJuryDutyHistory(p.days);
        return { content: [{ type: 'text', text: JSON.stringify(history, null, 2) }] };
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Invalid parameters: ${error.errors.map((e) => e.message).join(', ')}`);
    }
    if (error instanceof TribeunalAPIError) {
      throw new Error(`API Error: ${error.message}`);
    }
    throw error;
  }
}
