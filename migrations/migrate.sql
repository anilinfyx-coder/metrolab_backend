-- ============================================================
-- Metrolab incremental migrations (safe / idempotent)
-- Runs automatically on backend server start
-- ============================================================

-- ── Wallet ───────────────────────────────────────────────────
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS wallet_balance DECIMAL(12, 2) DEFAULT 0.00;
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS is_fixed_price BOOLEAN DEFAULT FALSE;
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS fixed_price_amount DECIMAL(12, 2) DEFAULT 0.00;

CREATE TABLE IF NOT EXISTS b2b_wallet_transactions (
    id SERIAL PRIMARY KEY,
    b2b_client_id INT REFERENCES b2b_clients(id),
    transaction_type VARCHAR(20) NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    closing_balance DECIMAL(12, 2) NOT NULL,
    description TEXT,
    reference_id INT,
    creation_timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_by_id INT
);

-- ── Global settings ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS global_settings (
    id SERIAL PRIMARY KEY,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    description TEXT,
    creation_timestamp TIMESTAMPTZ DEFAULT NOW(),
    updated_timestamp TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO global_settings (setting_key, setting_value, description)
VALUES
    ('drug_test_price', '15.00', 'Price for Drug Test'),
    ('alcohol_test_price', '20.00', 'Price for Alcohol Test'),
    ('alternate_test_price', '10.00', 'Price for Alternate Test')
ON CONFLICT (setting_key) DO NOTHING;

-- ── B2B client location (country / state / city) ─────────────
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS country_id INT;
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS state_id INT;
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS city_id INT;

CREATE INDEX IF NOT EXISTS idx_b2b_clients_country_id ON b2b_clients(country_id);
CREATE INDEX IF NOT EXISTS idx_b2b_clients_state_id ON b2b_clients(state_id);
CREATE INDEX IF NOT EXISTS idx_b2b_clients_city_id ON b2b_clients(city_id);

-- ── Password reset tokens ────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    account_table VARCHAR(50) NOT NULL,
    account_id INT NOT NULL,
    token_hash VARCHAR(128) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    creation_timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_email ON password_reset_tokens(email);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens(token_hash);

-- ── B2B overrides for report result parameters ───────────────
ALTER TABLE report_request_parameters ADD COLUMN IF NOT EXISTS source_parameter_id INT;
CREATE INDEX IF NOT EXISTS idx_report_request_parameters_source_b2b
    ON report_request_parameters(source_parameter_id, b2b_client_id)
    WHERE deleted = false;

-- ── Patient location (Country / State / City) ────────────────
ALTER TABLE patient ADD COLUMN IF NOT EXISTS country_id INT;
ALTER TABLE patient ADD COLUMN IF NOT EXISTS state_id INT;
ALTER TABLE patient ADD COLUMN IF NOT EXISTS city_id INT;
ALTER TABLE patient ADD COLUMN IF NOT EXISTS country VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_patient_country_id ON patient(country_id);
CREATE INDEX IF NOT EXISTS idx_patient_state_id ON patient(state_id);
CREATE INDEX IF NOT EXISTS idx_patient_city_id ON patient(city_id);

-- ── B2B Whitelabel Custom Domain ──────────────────────────────
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS custom_domain VARCHAR(255) UNIQUE;
