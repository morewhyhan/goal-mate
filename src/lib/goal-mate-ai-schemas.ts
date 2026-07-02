export const goalMateAiOutputSchemas = {
  goal_reasoning_card: {
    type: 'object',
    additionalProperties: false,
    required: [
      'purpose_summary',
      'horizon',
      'objective',
      'success_signals',
      'key_results',
      'necessary_conditions',
      'sufficient_condition_set',
      'current_gap',
      'recommended_focus',
      'confidence_score',
      'evidence',
    ],
    properties: {
      purpose_summary: { type: 'string', minLength: 1 },
      horizon: {
        type: 'object',
        additionalProperties: false,
        required: ['start_date', 'end_date', 'label'],
        properties: {
          start_date: { type: 'string' },
          end_date: { type: 'string' },
          label: { type: 'string' },
        },
      },
      objective: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'plain_language_summary'],
        properties: {
          title: { type: 'string', minLength: 1 },
          plain_language_summary: { type: 'string', minLength: 1 },
        },
      },
      success_signals: {
        type: 'array',
        minItems: 1,
        items: { type: 'string', minLength: 1 },
      },
      key_results: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'metric_type', 'current_value', 'target_value', 'progress', 'why_necessary'],
          properties: {
            title: { type: 'string', minLength: 1 },
            metric_type: { enum: ['boolean', 'count', 'percent', 'weight', 'text'] },
            current_value: { type: 'string' },
            target_value: { type: 'string' },
            progress: { type: 'number', minimum: 0, maximum: 1 },
            why_necessary: { type: 'string', minLength: 1 },
          },
        },
      },
      necessary_conditions: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'condition_type', 'status', 'why_required'],
          properties: {
            title: { type: 'string', minLength: 1 },
            condition_type: { enum: ['hard', 'assumed', 'supporting'] },
            status: { enum: ['missing', 'partial', 'satisfied', 'invalidated'] },
            why_required: { type: 'string', minLength: 1 },
          },
        },
      },
      sufficient_condition_set: { type: 'string', minLength: 1 },
      current_gap: {
        type: 'object',
        additionalProperties: false,
        required: ['condition_title', 'reason'],
        properties: {
          condition_title: { type: 'string', minLength: 1 },
          reason: { type: 'string', minLength: 1 },
        },
      },
      recommended_focus: { type: 'string', minLength: 1 },
      confidence_score: { type: 'number', minimum: 0, maximum: 1 },
      evidence: {
        type: 'array',
        minItems: 1,
        items: { type: 'string', minLength: 1 },
      },
    },
  },

  daily_action: {
    type: 'object',
    additionalProperties: false,
    required: [
      'title',
      'linked_condition',
      'done_when',
      'minimum_step',
      'fallback_action',
      'estimated_minutes',
      'checkin_question',
    ],
    properties: {
      title: { type: 'string', minLength: 1 },
      linked_condition: { type: 'string', minLength: 1 },
      done_when: { type: 'string', minLength: 1 },
      minimum_step: { type: 'string', minLength: 1 },
      fallback_action: { type: 'string', minLength: 1 },
      estimated_minutes: { type: 'integer', minimum: 1, maximum: 240 },
      checkin_question: { type: 'string', minLength: 1 },
    },
  },

  diagnosis: {
    type: 'object',
    additionalProperties: false,
    required: ['category', 'evidence', 'adjustment_type', 'next_question'],
    properties: {
      category: { enum: ['motivation', 'ability', 'prompt', 'path', 'condition', 'goal', 'unknown'] },
      evidence: { type: 'string', minLength: 1 },
      adjustment_type: { enum: ['keep', 'simplify', 'reschedule', 'reframe_goal', 'rebuild_path', 'pause_goal'] },
      next_question: { type: 'string', minLength: 1 },
      proposed_next_action: { type: 'string' },
    },
  },

  review: {
    type: 'object',
    additionalProperties: false,
    required: ['period', 'progress_summary', 'condition_changes', 'blocker_summary', 'next_focus', 'log_markdown'],
    properties: {
      period: { enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'goal_cycle'] },
      progress_summary: { type: 'string', minLength: 1 },
      condition_changes: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['condition_title', 'change_summary'],
          properties: {
            condition_title: { type: 'string', minLength: 1 },
            change_summary: { type: 'string', minLength: 1 },
          },
        },
      },
      blocker_summary: { type: 'string', minLength: 1 },
      next_focus: { type: 'string', minLength: 1 },
      log_markdown: { type: 'string', minLength: 1 },
    },
  },

  setting_change_draft: {
    type: 'object',
    additionalProperties: false,
    required: ['setting_key', 'old_value', 'new_value', 'impact', 'requires_confirmation'],
    properties: {
      setting_key: { type: 'string', minLength: 1 },
      old_value: {},
      new_value: {},
      impact: { type: 'string', minLength: 1 },
      requires_confirmation: { const: true },
    },
  },

  log_patch: {
    type: 'object',
    additionalProperties: false,
    required: ['target_log', 'write_mode', 'markdown_content', 'source_context'],
    properties: {
      target_log: { type: 'string', minLength: 1 },
      write_mode: { enum: ['append', 'replace_system_block', 'create'] },
      markdown_content: { type: 'string', minLength: 1 },
      source_context: {
        type: 'array',
        minItems: 1,
        items: { type: 'string', minLength: 1 },
      },
    },
  },
} as const

export type GoalMateAiOutputType = keyof typeof goalMateAiOutputSchemas
