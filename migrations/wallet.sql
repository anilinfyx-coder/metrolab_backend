-- Add wallet_balance to b2b_clients
ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS wallet_balance DECIMAL(12, 2) DEFAULT 0.00;

-- Create b2b_wallet_transactions table
CREATE TABLE IF NOT EXISTS b2b_wallet_transactions (
    id SERIAL PRIMARY KEY,
    b2b_client_id INT REFERENCES b2b_clients(id),
    transaction_type VARCHAR(20) NOT NULL, -- 'CREDIT' or 'DEBIT'
    amount DECIMAL(12, 2) NOT NULL,
    closing_balance DECIMAL(12, 2) NOT NULL,
    description TEXT,
    reference_id INT, -- e.g., employee test record ID
    creation_timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_by_id INT -- superadmin who recharged
);

-- Create global_settings table
CREATE TABLE IF NOT EXISTS global_settings (
    id SERIAL PRIMARY KEY,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    description TEXT,
    creation_timestamp TIMESTAMPTZ DEFAULT NOW(),
    updated_timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Seed initial test prices
INSERT INTO global_settings (setting_key, setting_value, description)
VALUES 
    ('drug_test_price', '15.00', 'Price for Drug Test'),
    ('alcohol_test_price', '20.00', 'Price for Alcohol Test'),
    ('alternate_test_price', '10.00', 'Price for Alternate Test')
ON CONFLICT (setting_key) DO NOTHING;
