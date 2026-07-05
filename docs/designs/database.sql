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
  provider VARCHAR(80) NOT NULL DEFAULT 'B.AI',
  default_model VARCHAR(120) NOT NULL DEFAULT 'gpt-5-nano',
  reasoning_model VARCHAR(120) NOT NULL DEFAULT '可选 reasoning model',
  api_base_url VARCHAR(300) NOT NULL DEFAULT 'https://api.b.ai',
  api_key_ref VARCHAR(200),
  fallback_strategy VARCHAR(80) NOT NULL DEFAULT 'retry_then_fallback',
  updated_at TIMESTAMP NOT NULL
);
-- Markdown document store: database-backed MD files and references.
CREATE TABLE markdown_documents (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  type VARCHAR(40) NOT NULL DEFAULT 'note',
  title VARCHAR(240) NOT NULL,
  path VARCHAR(500) NOT NULL,
  content TEXT NOT NULL,
  frontmatter JSON,
  linked_goal_ids JSON,
  linked_action_ids JSON,
  source VARCHAR(40) NOT NULL DEFAULT 'user',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, path)
);

CREATE INDEX idx_markdown_documents_user_id ON markdown_documents(user_id);
CREATE INDEX idx_markdown_documents_type ON markdown_documents(type);
CREATE INDEX idx_markdown_documents_source ON markdown_documents(source);
CREATE INDEX idx_markdown_documents_updated_at ON markdown_documents(updated_at);

CREATE TABLE markdown_document_links (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  from_document_id VARCHAR(36) NOT NULL,
  to_document_id VARCHAR(36),
  target_path VARCHAR(500) NOT NULL,
  link_type VARCHAR(40) NOT NULL DEFAULT 'wiki',
  context TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_markdown_document_links_user_id ON markdown_document_links(user_id);
CREATE INDEX idx_markdown_document_links_from_document_id ON markdown_document_links(from_document_id);
CREATE INDEX idx_markdown_document_links_to_document_id ON markdown_document_links(to_document_id);
CREATE INDEX idx_markdown_document_links_target_path ON markdown_document_links(target_path);
CREATE INDEX idx_markdown_document_links_link_type ON markdown_document_links(link_type);
