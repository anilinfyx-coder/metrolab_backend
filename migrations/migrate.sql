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
ALTER TABLE report_request_parameters ADD COLUMN IF NOT EXISTS b2b_client_id INT;
ALTER TABLE report_questions ADD COLUMN IF NOT EXISTS b2b_client_id INT;
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
-- Must exist for report PDF download / branding queries
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS custom_domain VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS idx_b2b_clients_custom_domain
    ON b2b_clients (custom_domain)
    WHERE custom_domain IS NOT NULL AND TRIM(custom_domain) <> '';

-- ── B2B Whitelabel & Additional Fields ────────────────────────
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS tagline VARCHAR(255);
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS primary_color_code VARCHAR(50);
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS logo_file VARCHAR(255);
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS report_header_file VARCHAR(255);
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS report_footer_file VARCHAR(255);
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS smtp_server VARCHAR(255);
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS smtp_port VARCHAR(50);
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS smtp_email VARCHAR(255);
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS smtp_password VARCHAR(255);

-- ── B2B Medical Officer & Approval Fields ─────────────────────
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS medical_officer_name VARCHAR(255);
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS medical_officer_position VARCHAR(255);
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS medical_officer_signature_file_name VARCHAR(255);
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS mrocc VARCHAR(255);
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS clia_number VARCHAR(255);
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS is_approval BOOLEAN DEFAULT false;
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS approval_note TEXT;

-- ── B2B Location & Contact Fields ─────────────────────────────
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS district_id INT;
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS region_id INT;
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS pincode VARCHAR(50);
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS public_phone_no VARCHAR(50);
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS public_email VARCHAR(255);
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS public_fax VARCHAR(50);
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS support_mobile VARCHAR(50);
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS support_email VARCHAR(255);
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS support_person_name VARCHAR(255);
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS website VARCHAR(255);


-- ── B2B Client Custom Prices Table ────────────────────────────
CREATE TABLE IF NOT EXISTS b2b_client_custom_prices (
    id SERIAL PRIMARY KEY,
    b2b_client_id INTEGER REFERENCES b2b_clients(id),
    lab_test_id INTEGER REFERENCES lab_tests(id),
    custom_price NUMERIC NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(b2b_client_id, lab_test_id)
);

-- ── B2B Display Options ───────────────────────────────────────
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS display_options_customized BOOLEAN DEFAULT FALSE;
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS show_collected_date BOOLEAN;
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS show_collected_time BOOLEAN;
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS show_received_date BOOLEAN;
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS show_received_time BOOLEAN;
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS show_reported_date BOOLEAN;
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS show_reported_time BOOLEAN;
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS show_report_status BOOLEAN;
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS show_regulation BOOLEAN;
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS show_specimen BOOLEAN;
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS show_final_result BOOLEAN;
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS show_requisition_no BOOLEAN;
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS show_test_remark BOOLEAN;
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS show_reason_for_test BOOLEAN;
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS show_final_result_disposition BOOLEAN;
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS show_final_remark BOOLEAN;
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS show_date_administered BOOLEAN;
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS show_test_date BOOLEAN;
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS show_test_time BOOLEAN;
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS show_test_performed_by BOOLEAN;
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS show_fasting BOOLEAN;
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS show_device_identifier BOOLEAN;
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS show_applied_to BOOLEAN;
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS show_lot BOOLEAN;
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS show_expire_date BOOLEAN;
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS show_date_read BOOLEAN;
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS show_mm_indurations BOOLEAN;
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS show_follow_up BOOLEAN;

-- ── Patient PII columns must hold AES ciphertext (iv:payload) ─
ALTER TABLE patient ALTER COLUMN dob TYPE TEXT USING dob::text;
ALTER TABLE patient ALTER COLUMN ssn TYPE TEXT;
ALTER TABLE patient ALTER COLUMN driving_license TYPE TEXT;

-- ── B2B Billing Mode Master Switch ────────────────────────
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS billing_mode VARCHAR(20) DEFAULT 'monthly';

-- ── Test-Specific Medical Officer & Signature ───────────────
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS medical_officer_name VARCHAR(255);
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS medical_officer_position VARCHAR(255);
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS mrocc VARCHAR(100);
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS clia_number VARCHAR(100);
ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS medical_officer_signature_file_name VARCHAR(255);

