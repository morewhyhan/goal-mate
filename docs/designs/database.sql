-- Goal Mate first-version database design draft.
-- This file is a current design fact, not a migration-ready final schema.

CREATE TABLE users (
  id VARCHAR(64) PRIMARY KEY,
  display_name VARCHAR(120),
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
  locale VARCHAR(16) NOT NULL DEFAULT 'zh-CN',
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE goals (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id),
  title VARCHAR(240) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  priority VARCHAR(32) NOT NULL DEFAULT 'medium',
  risk_status VARCHAR(32) NOT NULL DEFAULT 'normal',
  current_focus BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE objectives (
  id VARCHAR(64) PRIMARY KEY,
  goal_id VARCHAR(64) NOT NULL REFERENCES goals(id),
  title VARCHAR(240) NOT NULL,
  horizon VARCHAR(120),
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE key_results (
  id VARCHAR(64) PRIMARY KEY,
  objective_id VARCHAR(64) NOT NULL REFERENCES objectives(id),
  title VARCHAR(300) NOT NULL,
  metric_type VARCHAR(32) NOT NULL DEFAULT 'qualitative',
  current_value VARCHAR(80),
  target_value VARCHAR(80),
  status VARCHAR(32) NOT NULL DEFAULT 'unclear',
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE wbs_items (
  id VARCHAR(64) PRIMARY KEY,
  goal_id VARCHAR(64) NOT NULL REFERENCES goals(id),
  parent_id VARCHAR(64),
  title VARCHAR(240) NOT NULL,
  start_date DATE,
  end_date DATE,
  status VARCHAR(32) NOT NULL DEFAULT 'todo',
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE daily_actions (
  id VARCHAR(64) PRIMARY KEY,
  goal_id VARCHAR(64) NOT NULL REFERENCES goals(id),
  key_result_id VARCHAR(64),
  action_date DATE NOT NULL,
  title VARCHAR(240) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'planned',
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE log_records (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id),
  cycle_type VARCHAR(24) NOT NULL,
  cycle_key VARCHAR(40) NOT NULL,
  path VARCHAR(400) NOT NULL,
  markdown TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  UNIQUE(user_id, path)
);

CREATE TABLE agent_conversations (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id),
  title VARCHAR(240) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE agent_messages (
  id VARCHAR(64) PRIMARY KEY,
  conversation_id VARCHAR(64) NOT NULL REFERENCES agent_conversations(id),
  role VARCHAR(24) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE user_settings (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id),
  category VARCHAR(64) NOT NULL,
  key VARCHAR(120) NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  UNIQUE(user_id, category, key)
);

CREATE TABLE model_configs (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id),
  provider VARCHAR(80) NOT NULL DEFAULT 'deepseek',
  default_model VARCHAR(120) NOT NULL DEFAULT 'DeepSeek V4 Flash',
  reasoning_model VARCHAR(120) NOT NULL DEFAULT 'DeepSeek Reasoner',
  api_base_url VARCHAR(300) NOT NULL DEFAULT 'https://api.deepseek.com',
  api_key_ref VARCHAR(200),
  fallback_strategy VARCHAR(80) NOT NULL DEFAULT 'retry_then_fallback',
  updated_at TIMESTAMP NOT NULL
);
