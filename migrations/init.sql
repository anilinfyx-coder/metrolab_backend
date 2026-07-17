-- ============================================================
-- Metrolab PostgreSQL Database Schema
-- Auto-generated from .NET C# Models
-- ============================================================

-- ============================================================
-- ADMIN USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_users (
    id                    SERIAL PRIMARY KEY,
    creation_timestamp    TIMESTAMPTZ DEFAULT NOW(),
    created_by_id         INT,
    role_id               INT,
    uid                   VARCHAR(100),
    name                  VARCHAR(255) NOT NULL,
    mobile                VARCHAR(50),
    email                 VARCHAR(255),
    password              VARCHAR(500) NOT NULL,
    image_file            VARCHAR(500),
    deleted               BOOLEAN DEFAULT FALSE,
    deleted_timestamp     TIMESTAMPTZ,
    deleted_by_id         INT,
    status                BOOLEAN DEFAULT TRUE,
    user_id               INT,
    role_type_id          INT
);

-- ============================================================
-- SUPER ADMIN
-- ============================================================
CREATE TABLE IF NOT EXISTS super_admin (
    id                    SERIAL PRIMARY KEY,
    creation_timestamp    TIMESTAMPTZ DEFAULT NOW(),
    created_by_id         INT,
    user_id               INT,
    uid                   VARCHAR(100),
    name                  VARCHAR(255) NOT NULL,
    mobile                VARCHAR(50),
    email                 VARCHAR(255),
    role_type_id          INT,
    role_id               INT,
    password              VARCHAR(500),
    image_file            VARCHAR(500),
    deleted               BOOLEAN DEFAULT FALSE,
    deleted_timestamp     TIMESTAMPTZ,
    deleted_by_id         INT,
    status                BOOLEAN DEFAULT TRUE
);

-- ============================================================
-- ROLE TYPES
-- ============================================================
CREATE TABLE IF NOT EXISTS role_types (
    id                    SERIAL PRIMARY KEY,
    creation_timestamp    TIMESTAMPTZ DEFAULT NOW(),
    created_by_id         INT,
    user_id               INT,
    role_type_id          INT,
    title                 VARCHAR(255) NOT NULL,
    description           TEXT,
    deleted               BOOLEAN DEFAULT FALSE,
    deleted_timestamp     TIMESTAMPTZ,
    deleted_by_id         INT,
    status                BOOLEAN DEFAULT TRUE
);

-- ============================================================
-- ACTION NAMES (Permissions)
-- ============================================================
CREATE TABLE IF NOT EXISTS action_names (
    id                    SERIAL PRIMARY KEY,
    creation_timestamp    TIMESTAMPTZ DEFAULT NOW(),
    controller_name       VARCHAR(255),
    action_name           VARCHAR(255),
    open_access           BOOLEAN DEFAULT FALSE,
    role_type_id          INT,
    role_id               INT,
    deleted               BOOLEAN DEFAULT FALSE,
    deleted_timestamp     TIMESTAMPTZ,
    deleted_by_id         INT,
    status                BOOLEAN DEFAULT TRUE,
    user_id               INT
);

-- ============================================================
-- PERMISSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS permissions (
    id                    SERIAL PRIMARY KEY,
    creation_timestamp    TIMESTAMPTZ DEFAULT NOW(),
    user_id               INT,
    role_type_id          INT,
    created_by_id         INT,
    controller_name_id    INT,
    controller_name       VARCHAR(255),
    action_name_id        INT,
    action_name           VARCHAR(255),
    role_id               INT,
    role                  VARCHAR(100),
    permission            BOOLEAN DEFAULT FALSE,
    deleted               BOOLEAN DEFAULT FALSE,
    deleted_timestamp     TIMESTAMPTZ,
    deleted_by_id         INT,
    status                BOOLEAN DEFAULT TRUE
);

-- ============================================================
-- COUNTRY / STATE / DISTRICT / CITY / REGION
-- ============================================================
CREATE TABLE IF NOT EXISTS country (
    id                    SERIAL PRIMARY KEY,
    creation_timestamp    TIMESTAMPTZ DEFAULT NOW(),
    created_by_id         INT,
    acronym               VARCHAR(20),
    name                  VARCHAR(255) NOT NULL,
    description           TEXT,
    image_file            VARCHAR(500),
    deleted               BOOLEAN DEFAULT FALSE,
    deleted_timestamp     TIMESTAMPTZ,
    deleted_by_id         INT,
    status                BOOLEAN DEFAULT TRUE,
    user_id               INT,
    role_type_id          INT
);

CREATE TABLE IF NOT EXISTS state (
    id                    SERIAL PRIMARY KEY,
    creation_timestamp    TIMESTAMPTZ DEFAULT NOW(),
    created_by_id         INT,
    country_id            INT REFERENCES country(id),
    acronym               VARCHAR(20),
    name                  VARCHAR(255) NOT NULL,
    description           TEXT,
    image_file            VARCHAR(500),
    deleted               BOOLEAN DEFAULT FALSE,
    deleted_timestamp     TIMESTAMPTZ,
    deleted_by_id         INT,
    status                BOOLEAN DEFAULT TRUE,
    user_id               INT,
    role_type_id          INT
);

CREATE TABLE IF NOT EXISTS district (
    id                    SERIAL PRIMARY KEY,
    creation_timestamp    TIMESTAMPTZ DEFAULT NOW(),
    created_by_id         INT,
    country_id            INT,
    state_id              INT REFERENCES state(id),
    acronym               VARCHAR(20),
    name                  VARCHAR(255) NOT NULL,
    description           TEXT,
    image_file            VARCHAR(500),
    deleted               BOOLEAN DEFAULT FALSE,
    deleted_timestamp     TIMESTAMPTZ,
    deleted_by_id         INT,
    status                BOOLEAN DEFAULT TRUE,
    user_id               INT,
    role_type_id          INT
);

CREATE TABLE IF NOT EXISTS city (
    id                    SERIAL PRIMARY KEY,
    creation_timestamp    TIMESTAMPTZ DEFAULT NOW(),
    created_by_id         INT,
    country_id            INT,
    state_id              INT,
    district_id           INT,
    acronym               VARCHAR(20),
    name                  VARCHAR(255) NOT NULL,
    description           TEXT,
    image_file            VARCHAR(500),
    deleted               BOOLEAN DEFAULT FALSE,
    deleted_timestamp     TIMESTAMPTZ,
    deleted_by_id         INT,
    status                BOOLEAN DEFAULT TRUE,
    user_id               INT,
    role_type_id          INT
);

CREATE TABLE IF NOT EXISTS region (
    id                    SERIAL PRIMARY KEY,
    creation_timestamp    TIMESTAMPTZ DEFAULT NOW(),
    created_by_id         INT,
    country_id            INT,
    state_id              INT,
    city_id               INT,
    district_id           INT,
    name                  VARCHAR(255) NOT NULL,
    acronym               VARCHAR(20),
    description           TEXT,
    image_file            VARCHAR(500),
    deleted               BOOLEAN DEFAULT FALSE,
    deleted_timestamp     TIMESTAMPTZ,
    deleted_by_id         INT,
    status                BOOLEAN DEFAULT TRUE,
    user_id               INT,
    role_type_id          INT
);

-- ============================================================
-- B2B CLIENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS b2b_clients (
    id                          SERIAL PRIMARY KEY,
    creation_timestamp          TIMESTAMPTZ DEFAULT NOW(),
    created_by_id               INT,
    role_id                     INT,
    company_name                VARCHAR(255) NOT NULL,
    contact_person_name         VARCHAR(255),
    mobile                      VARCHAR(50),
    public_phone_no             VARCHAR(50),
    email                       VARCHAR(255),
    public_email                VARCHAR(255),
    public_fax                  VARCHAR(50),
    address                     TEXT,
    country_id                  INT,
    state_id                    INT,
    city_id                     INT,
    district_id                 INT,
    region_id                   INT,
    pincode                     VARCHAR(20),
    support_mobile              VARCHAR(50),
    support_email               VARCHAR(255),
    support_person_name         VARCHAR(255),
    password                    VARCHAR(500),
    tagline                     TEXT,
    logo_file                   VARCHAR(500),
    report_header_file          VARCHAR(500),
    report_footer_file          VARCHAR(500),
    primary_color_code          VARCHAR(20),
    website                     VARCHAR(500),
    medical_officer_name        VARCHAR(255),
    mrocc                       VARCHAR(255),
    clia_number                 VARCHAR(100),
    medical_officer_position    VARCHAR(255),
    medical_officer_signature_file_name VARCHAR(500),
    is_approval                 BOOLEAN DEFAULT FALSE,
    approval_note               TEXT,
    smtp_server                 VARCHAR(255),
    smtp_port                   VARCHAR(20),
    smtp_email                  VARCHAR(255),
    smtp_password               VARCHAR(255),
    deleted                     BOOLEAN DEFAULT FALSE,
    deleted_timestamp           TIMESTAMPTZ,
    deleted_by_id               INT,
    status                      BOOLEAN DEFAULT TRUE,
    user_id                     INT,
    role_type_id                INT
);

-- ============================================================
-- B2B CLIENT SUBSCRIPTION
-- ============================================================
CREATE TABLE IF NOT EXISTS b2b_client_subscription (
    id                    SERIAL PRIMARY KEY,
    creation_timestamp    TIMESTAMPTZ DEFAULT NOW(),
    created_by_id         INT,
    b2b_client_id         INT REFERENCES b2b_clients(id),
    start_date            DATE,
    end_date              DATE,
    amount                DECIMAL(10,2),
    deleted               BOOLEAN DEFAULT FALSE,
    deleted_timestamp     TIMESTAMPTZ,
    deleted_by_id         INT,
    status                BOOLEAN DEFAULT TRUE,
    user_id               INT,
    role_type_id          INT
);

-- ============================================================
-- B2B CLIENT DOCUMENT
-- ============================================================
CREATE TABLE IF NOT EXISTS b2b_client_document (
    id                    SERIAL PRIMARY KEY,
    creation_timestamp    TIMESTAMPTZ DEFAULT NOW(),
    created_by_id         INT,
    b2b_client_id         INT REFERENCES b2b_clients(id),
    type_data_id          INT,
    file_name             VARCHAR(500),
    deleted               BOOLEAN DEFAULT FALSE,
    deleted_timestamp     TIMESTAMPTZ,
    deleted_by_id         INT,
    status                BOOLEAN DEFAULT TRUE,
    user_id               INT,
    role_type_id          INT
);

-- ============================================================
-- CORPORATE CLIENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS corporate_clients (
    id                      SERIAL PRIMARY KEY,
    creation_timestamp      TIMESTAMPTZ DEFAULT NOW(),
    created_by_id           INT,
    role_id                 INT,
    b2b_client_id           INT REFERENCES b2b_clients(id),
    uid                     VARCHAR(100),
    company_name            VARCHAR(255) NOT NULL,
    contact_person_name     VARCHAR(255),
    mobile                  VARCHAR(50),
    email                   VARCHAR(255),
    address                 TEXT,
    country_id              INT,
    state_id                INT,
    city_id                 INT,
    district_id             INT,
    region_id               INT,
    pincode                 VARCHAR(20),
    password                VARCHAR(500),
    verification_status     BOOLEAN DEFAULT FALSE,
    verification_timestamp  TIMESTAMPTZ,
    verification_by_id      INT,
    deleted                 BOOLEAN DEFAULT FALSE,
    deleted_timestamp       TIMESTAMPTZ,
    deleted_by_id           INT,
    status                  BOOLEAN DEFAULT TRUE,
    user_id                 INT,
    role_type_id            INT
);

-- ============================================================
-- EMPLOYEES
-- ============================================================
CREATE TABLE IF NOT EXISTS employees (
    id                    SERIAL PRIMARY KEY,
    creation_timestamp    TIMESTAMPTZ DEFAULT NOW(),
    created_by_id         INT,
    corporate_client_id   INT,
    uid                   VARCHAR(100),
    company_uid           VARCHAR(100),
    first_name            VARCHAR(255) NOT NULL,
    last_name             VARCHAR(255),
    mobile                VARCHAR(50),
    email                 VARCHAR(255),
    gender                INT,
    dob                   DATE,
    street1               VARCHAR(500),
    street2               VARCHAR(500),
    city                  VARCHAR(255),
    state                 VARCHAR(100),
    zipcode               VARCHAR(20),
    driving_license       VARCHAR(100),
    driving_license_state VARCHAR(100),
    department            VARCHAR(255),
    ssn                   VARCHAR(50),
    deleted               BOOLEAN DEFAULT FALSE,
    deleted_timestamp     TIMESTAMPTZ,
    deleted_by_id         INT,
    status                BOOLEAN DEFAULT TRUE,
    user_id               INT,
    role_type_id          INT
);

-- ============================================================
-- PATIENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS patient (
    id                    SERIAL PRIMARY KEY,
    creation_timestamp    TIMESTAMPTZ DEFAULT NOW(),
    created_by_id         INT,
    b2b_client_id         INT REFERENCES b2b_clients(id),
    uid                   VARCHAR(100),
    name                  VARCHAR(255) NOT NULL,
    driving_license       VARCHAR(100),
    mobile                VARCHAR(50),
    email                 VARCHAR(255),
    gender                INT,
    dob                   DATE,
    street1               VARCHAR(500),
    street2               VARCHAR(500),
    city                  VARCHAR(255),
    state                 VARCHAR(100),
    zipcode               VARCHAR(20),
    driving_license_state VARCHAR(100),
    ssn                   VARCHAR(50),
    deleted               BOOLEAN DEFAULT FALSE,
    deleted_timestamp     TIMESTAMPTZ,
    deleted_by_id         INT,
    status                BOOLEAN DEFAULT TRUE,
    user_id               INT,
    role_type_id          INT
);

-- ============================================================
-- SPECIMEN TYPE
-- ============================================================
CREATE TABLE IF NOT EXISTS specimen_type (
    id                    SERIAL PRIMARY KEY,
    creation_timestamp    TIMESTAMPTZ DEFAULT NOW(),
    created_by_id         INT,
    b2b_client_id         INT,
    name                  VARCHAR(255) NOT NULL,
    description           TEXT,
    deleted               BOOLEAN DEFAULT FALSE,
    deleted_timestamp     TIMESTAMPTZ,
    deleted_by_id         INT,
    status                BOOLEAN DEFAULT TRUE,
    user_id               INT,
    role_type_id          INT
);

-- ============================================================
-- DRUGS
-- ============================================================
CREATE TABLE IF NOT EXISTS drugs (
    id                      SERIAL PRIMARY KEY,
    creation_timestamp      TIMESTAMPTZ DEFAULT NOW(),
    created_by_id           INT,
    name                    VARCHAR(255) NOT NULL,
    screening_cutoff        INT,
    confirmation_cutoff     INT,
    deleted                 BOOLEAN DEFAULT FALSE,
    deleted_timestamp       TIMESTAMPTZ,
    deleted_by_id           INT,
    status                  BOOLEAN DEFAULT TRUE,
    user_id                 INT,
    role_type_id            INT
);

CREATE TABLE IF NOT EXISTS specimen_type_drug_linking (
    id                    SERIAL PRIMARY KEY,
    creation_timestamp    TIMESTAMPTZ DEFAULT NOW(),
    created_by_id         INT,
    b2b_client_id         INT,
    specimen_type_id      INT REFERENCES specimen_type(id),
    drug_id               INT REFERENCES drugs(id),
    lab_test_id           INT REFERENCES lab_tests(id),  -- links to lab_test (new model, replaces drug_id usage)
    deleted               BOOLEAN DEFAULT FALSE,
    deleted_timestamp     TIMESTAMPTZ,
    deleted_by_id         INT,
    status                BOOLEAN DEFAULT TRUE,
    user_id               INT,
    role_type_id          INT
);

-- ============================================================
-- LAB TESTS
-- ============================================================
CREATE TABLE IF NOT EXISTS lab_tests (
    id                           SERIAL PRIMARY KEY,
    creation_timestamp           TIMESTAMPTZ DEFAULT NOW(),
    created_by_id                INT,
    name                         VARCHAR(255) NOT NULL,
    description                  TEXT,
    show_collected_date          BOOLEAN DEFAULT FALSE,
    show_collected_time          BOOLEAN DEFAULT FALSE,
    show_received_date           BOOLEAN DEFAULT FALSE,
    show_received_time           BOOLEAN DEFAULT FALSE,
    show_reported_date           BOOLEAN DEFAULT FALSE,
    show_reported_time           BOOLEAN DEFAULT FALSE,
    show_report_status           BOOLEAN DEFAULT FALSE,
    show_regulation              BOOLEAN DEFAULT FALSE,
    show_specimen                BOOLEAN DEFAULT FALSE,
    show_final_result            BOOLEAN DEFAULT FALSE,
    show_requisition_no          BOOLEAN DEFAULT FALSE,
    show_test_remark             BOOLEAN DEFAULT FALSE,
    show_reason_for_test         BOOLEAN DEFAULT FALSE,
    show_final_result_disposition BOOLEAN DEFAULT FALSE,
    show_final_remark            BOOLEAN DEFAULT FALSE,
    show_date_administered       BOOLEAN DEFAULT FALSE,
    show_test_date               BOOLEAN DEFAULT FALSE,
    show_test_time               BOOLEAN DEFAULT FALSE,
    show_test_performed_by       BOOLEAN DEFAULT FALSE,
    show_fasting                 BOOLEAN DEFAULT FALSE,
    show_device_identifier       BOOLEAN DEFAULT FALSE,
    show_applied_to              BOOLEAN DEFAULT FALSE,
    show_lot                     BOOLEAN DEFAULT FALSE,
    show_expire_date             BOOLEAN DEFAULT FALSE,
    show_date_read               BOOLEAN DEFAULT FALSE,
    show_mm_indurations          BOOLEAN DEFAULT FALSE,
    show_follow_up               BOOLEAN DEFAULT FALSE,
    default_view                 BOOLEAN DEFAULT FALSE,
    deleted                      BOOLEAN DEFAULT FALSE,
    deleted_timestamp            TIMESTAMPTZ,
    deleted_by_id                INT,
    status                       BOOLEAN DEFAULT TRUE,
    user_id                      INT,
    role_type_id                 INT
);

CREATE TABLE IF NOT EXISTS b2b_client_lab_test_access (
    id                    SERIAL PRIMARY KEY,
    creation_timestamp    TIMESTAMPTZ DEFAULT NOW(),
    created_by_id         INT,
    b2b_client_id         INT REFERENCES b2b_clients(id),
    lab_test_id           INT REFERENCES lab_tests(id),
    deleted               BOOLEAN DEFAULT FALSE,
    deleted_timestamp     TIMESTAMPTZ,
    deleted_by_id         INT,
    status                BOOLEAN DEFAULT TRUE,
    user_id               INT,
    role_type_id          INT
);

CREATE TABLE IF NOT EXISTS lab_test_category_specimen_type_mapping (
    id                    SERIAL PRIMARY KEY,
    creation_timestamp    TIMESTAMPTZ DEFAULT NOW(),
    created_by_id         INT,
    lab_test_id           INT REFERENCES lab_tests(id),
    specimen_type_id      INT REFERENCES specimen_type(id),
    deleted               BOOLEAN DEFAULT FALSE,
    deleted_timestamp     TIMESTAMPTZ,
    deleted_by_id         INT,
    status                BOOLEAN DEFAULT TRUE,
    user_id               INT,
    role_type_id          INT
);

-- ============================================================
-- REPORT QUESTIONS & PARAMETERS
-- ============================================================
CREATE TABLE IF NOT EXISTS report_questions (
    id                    SERIAL PRIMARY KEY,
    creation_timestamp    TIMESTAMPTZ DEFAULT NOW(),
    created_by_id         INT,
    lab_test_id           INT REFERENCES lab_tests(id),
    question_text         TEXT,
    description           TEXT,
    answer_type           INT,
    answer_option         TEXT,
    deleted               BOOLEAN DEFAULT FALSE,
    deleted_timestamp     TIMESTAMPTZ,
    deleted_by_id         INT,
    status                BOOLEAN DEFAULT TRUE,
    user_id               INT,
    role_type_id          INT
);

CREATE TABLE IF NOT EXISTS report_request_parameters (
    id                      SERIAL PRIMARY KEY,
    creation_timestamp      TIMESTAMPTZ DEFAULT NOW(),
    created_by_id           INT,
    lab_test_id             INT REFERENCES lab_tests(id),
    b2b_client_id           INT,
    name                    VARCHAR(255),
    description             TEXT,
    placeholder             VARCHAR(500),
    label                   VARCHAR(255),
    input_type              INT,
    upload_type             VARCHAR(100),
    validate_regex          VARCHAR(500),
    is_mandatory            BOOLEAN DEFAULT FALSE,
    input_option            TEXT,
    unit_text               VARCHAR(100),
    screening_cutoff        VARCHAR(100),
    confirmation_cutoff     VARCHAR(100),
    deleted                 BOOLEAN DEFAULT FALSE,
    deleted_timestamp       TIMESTAMPTZ,
    deleted_by_id           INT,
    status                  BOOLEAN DEFAULT TRUE,
    user_id                 INT,
    role_type_id            INT
);

-- ============================================================
-- WAITING LIST
-- ============================================================
CREATE TABLE IF NOT EXISTS waiting_list (
    id                    SERIAL PRIMARY KEY,
    creation_timestamp    TIMESTAMPTZ DEFAULT NOW(),
    created_by_id         INT,
    b2b_client_id         INT REFERENCES b2b_clients(id),
    uid                   VARCHAR(100),
    patient_id            INT REFERENCES patient(id),
    corporate_client_id   INT,
    employee_id           INT,
    reason_for_test       TEXT,
    requisition_no        VARCHAR(100),
    deleted               BOOLEAN DEFAULT FALSE,
    deleted_timestamp     TIMESTAMPTZ,
    deleted_by_id         INT,
    status                BOOLEAN DEFAULT TRUE,
    user_id               INT,
    role_type_id          INT
);

CREATE TABLE IF NOT EXISTS waiting_test_lab_test (
    id                    SERIAL PRIMARY KEY,
    creation_timestamp    TIMESTAMPTZ DEFAULT NOW(),
    created_by_id         INT,
    b2b_client_id         INT,
    waiting_list_id       INT REFERENCES waiting_list(id),
    lab_test_id           INT REFERENCES lab_tests(id),
    deleted               BOOLEAN DEFAULT FALSE,
    deleted_timestamp     TIMESTAMPTZ,
    deleted_by_id         INT,
    status                BOOLEAN DEFAULT TRUE,
    user_id               INT,
    role_type_id          INT
);

-- ============================================================
-- DRUG TEST
-- ============================================================
CREATE TABLE IF NOT EXISTS drug_test (
    id                        SERIAL PRIMARY KEY,
    creation_timestamp        TIMESTAMPTZ DEFAULT NOW(),
    created_by_id             INT,
    b2b_client_id             INT REFERENCES b2b_clients(id),
    uid                       VARCHAR(100),
    patient_id                INT REFERENCES patient(id),
    waiting_list_id           INT,
    waiting_list_lab_test_id  INT,
    reason_for_test           TEXT,
    collected_timestamp       TIMESTAMPTZ,
    received_timestamp        TIMESTAMPTZ,
    reported_timestamp        TIMESTAMPTZ,
    regulation                VARCHAR(255),
    specimen_type             VARCHAR(100),
    final_result              VARCHAR(255),
    test_remark               TEXT,
    final_result_disposition  VARCHAR(255),
    final_remark              TEXT,
    requisition_no            VARCHAR(100),
    deleted                   BOOLEAN DEFAULT FALSE,
    deleted_timestamp         TIMESTAMPTZ,
    deleted_by_id             INT,
    status                    BOOLEAN DEFAULT TRUE,
    user_id                   INT,
    role_type_id              INT
);

CREATE TABLE IF NOT EXISTS drug_test_drugs (
    id                      SERIAL PRIMARY KEY,
    creation_timestamp      TIMESTAMPTZ DEFAULT NOW(),
    created_by_id           INT,
    b2b_client_id           INT,
    drug_test_id            INT REFERENCES drug_test(id),
    name                    VARCHAR(255),
    screening_cutoff        INT,
    confirmation_cutoff     INT,
    result                  BOOLEAN,
    deleted                 BOOLEAN DEFAULT FALSE,
    deleted_timestamp       TIMESTAMPTZ,
    deleted_by_id           INT,
    status                  BOOLEAN DEFAULT TRUE,
    user_id                 INT,
    role_type_id            INT
);

-- ============================================================
-- ALCOHOL TEST
-- ============================================================
CREATE TABLE IF NOT EXISTS alcohol_test (
    id                        SERIAL PRIMARY KEY,
    creation_timestamp        TIMESTAMPTZ DEFAULT NOW(),
    created_by_id             INT,
    b2b_client_id             INT REFERENCES b2b_clients(id),
    uid                       VARCHAR(100),
    patient_id                INT REFERENCES patient(id),
    waiting_list_id           INT,
    waiting_list_lab_test_id  INT,
    reason_for_test           TEXT,
    collected_timestamp       TIMESTAMPTZ,
    received_timestamp        TIMESTAMPTZ,
    reported_timestamp        TIMESTAMPTZ,
    regulation                VARCHAR(255),
    specimen_type             VARCHAR(100),
    quant                     INT,
    final_result_disposition  VARCHAR(255),
    remark                    TEXT,
    requisition_no            VARCHAR(100),
    deleted                   BOOLEAN DEFAULT FALSE,
    deleted_timestamp         TIMESTAMPTZ,
    deleted_by_id             INT,
    status                    BOOLEAN DEFAULT TRUE,
    user_id                   INT,
    role_type_id              INT
);

-- ============================================================
-- COVID TEST
-- ============================================================
CREATE TABLE IF NOT EXISTS covid_test (
    id                          SERIAL PRIMARY KEY,
    creation_timestamp          TIMESTAMPTZ DEFAULT NOW(),
    created_by_id               INT,
    b2b_client_id               INT REFERENCES b2b_clients(id),
    uid                         VARCHAR(100),
    patient_id                  INT REFERENCES patient(id),
    waiting_list_id             INT,
    waiting_list_lab_test_id    INT,
    reason_for_test             TEXT,
    collected_timestamp         TIMESTAMPTZ,
    received_timestamp          TIMESTAMPTZ,
    reported_timestamp          TIMESTAMPTZ,
    is_patient_fasting          BOOLEAN DEFAULT FALSE,
    pcr_analyte                 BOOLEAN DEFAULT FALSE,
    ia_analyte                  BOOLEAN DEFAULT FALSE,
    specimen                    VARCHAR(100),
    requisition                 VARCHAR(100),
    report_status               VARCHAR(100),
    pcr_result                  INT,
    pcr_reference_range         INT,
    ia_result                   INT,
    ia_reference_range          INT,
    reference_range_note        TEXT,
    clinical_significance_note  TEXT,
    result_interpretation_note  TEXT,
    remark                      TEXT,
    requisition_no              VARCHAR(100),
    email_sent                  BOOLEAN DEFAULT FALSE,
    deleted                     BOOLEAN DEFAULT FALSE,
    deleted_timestamp           TIMESTAMPTZ,
    deleted_by_id               INT,
    status                      BOOLEAN DEFAULT TRUE,
    user_id                     INT,
    role_type_id                INT
);

CREATE TABLE IF NOT EXISTS covid_description (
    id                                  SERIAL PRIMARY KEY,
    updation_timestamp                  TIMESTAMPTZ DEFAULT NOW(),
    updated_by_id                       INT,
    b2b_client_id                       INT,
    test_range_description              TEXT,
    critical_significance_description   TEXT,
    result_interpretation_description   TEXT,
    reference_range_note_description    TEXT,
    user_id                             INT,
    role_type_id                        INT
);

-- ============================================================
-- TB TEST
-- ============================================================
CREATE TABLE IF NOT EXISTS tb_test (
    id                        SERIAL PRIMARY KEY,
    creation_timestamp        TIMESTAMPTZ DEFAULT NOW(),
    created_by_id             INT,
    b2b_client_id             INT REFERENCES b2b_clients(id),
    uid                       VARCHAR(100),
    patient_id                INT REFERENCES patient(id),
    waiting_list_id           INT,
    waiting_list_lab_test_id  INT,
    reason_for_test           TEXT,
    collected_timestamp       TIMESTAMPTZ,
    received_timestamp        TIMESTAMPTZ,
    reported_timestamp        TIMESTAMPTZ,
    date_administered         DATE,
    lot                       VARCHAR(100),
    expiry_date               DATE,
    applied_to_arm            VARCHAR(100),
    date_read                 DATE,
    mm_indurations            VARCHAR(100),
    final_result              VARCHAR(255),
    follow_up                 TEXT,
    requisition_no            VARCHAR(100),
    deleted                   BOOLEAN DEFAULT FALSE,
    deleted_timestamp         TIMESTAMPTZ,
    deleted_by_id             INT,
    status                    BOOLEAN DEFAULT TRUE,
    user_id                   INT,
    role_type_id              INT
);

-- ============================================================
-- LAB TEST CATEGORY REPORT (Other Tests)
-- ============================================================
CREATE TABLE IF NOT EXISTS lab_test_category_report (
    id                          SERIAL PRIMARY KEY,
    creation_timestamp          TIMESTAMPTZ DEFAULT NOW(),
    created_by_id               INT,
    uid                         VARCHAR(100),
    patient_id                  INT REFERENCES patient(id),
    lab_test_id                 INT REFERENCES lab_tests(id),
    waiting_list_id             INT,
    waiting_list_lab_test_id    INT,
    reason_for_test             TEXT,
    collected_timestamp         TIMESTAMPTZ,
    received_timestamp          TIMESTAMPTZ,
    reported_timestamp          TIMESTAMPTZ,
    date_of_test                DATE,
    regulation                  VARCHAR(255),
    specimen_type_id            INT,
    final_result                VARCHAR(255),
    test_remark                 TEXT,
    final_result_disposition    VARCHAR(255),
    final_remark                TEXT,
    requisition_no              VARCHAR(100),
    date_administered           DATE,
    fasting                     VARCHAR(100),
    device_identifier           VARCHAR(255),
    test_performed_by           VARCHAR(255),
    test_result                 INT,
    follow_up                   TEXT,
    report_status               VARCHAR(100),
    reference_range_note        TEXT,
    clinical_significance_note  TEXT,
    result_interpretation_note  TEXT,
    applied_to_arm              VARCHAR(100),
    lot                         VARCHAR(100),
    expiry_date                 DATE,
    date_read                   DATE,
    mm_indurations              VARCHAR(100),
    is_locked                   BOOLEAN DEFAULT FALSE,
    is_email_send               BOOLEAN DEFAULT FALSE,
    deleted                     BOOLEAN DEFAULT FALSE,
    deleted_timestamp           TIMESTAMPTZ,
    deleted_by_id               INT,
    status                      BOOLEAN DEFAULT TRUE,
    user_id                     INT,
    role_type_id                INT
);

CREATE TABLE IF NOT EXISTS lab_test_category_report_question_answer (
    id                          SERIAL PRIMARY KEY,
    creation_timestamp          TIMESTAMPTZ DEFAULT NOW(),
    created_by_id               INT,
    lab_test_category_report_id INT REFERENCES lab_test_category_report(id),
    report_questions_id         INT REFERENCES report_questions(id),
    value                       TEXT,
    deleted                     BOOLEAN DEFAULT FALSE,
    deleted_timestamp           TIMESTAMPTZ,
    deleted_by_id               INT,
    status                      BOOLEAN DEFAULT TRUE,
    user_id                     INT,
    role_type_id                INT
);

CREATE TABLE IF NOT EXISTS lab_test_category_report_request_parameter_value (
    id                          SERIAL PRIMARY KEY,
    creation_timestamp          TIMESTAMPTZ DEFAULT NOW(),
    created_by_id               INT,
    lab_test_category_report_id INT REFERENCES lab_test_category_report(id),
    report_request_parameters_id INT REFERENCES report_request_parameters(id),
    value                       TEXT,
    deleted                     BOOLEAN DEFAULT FALSE,
    deleted_timestamp           TIMESTAMPTZ,
    deleted_by_id               INT,
    status                      BOOLEAN DEFAULT TRUE,
    user_id                     INT,
    role_type_id                INT
);

-- ============================================================
-- TEST REQUESTS
-- ============================================================
CREATE TABLE IF NOT EXISTS test_request (
    id                    SERIAL PRIMARY KEY,
    creation_timestamp    TIMESTAMPTZ DEFAULT NOW(),
    created_by_id         INT,
    b2b_client_id         INT REFERENCES b2b_clients(id),
    uid                   VARCHAR(100),
    patient_id            INT REFERENCES patient(id),
    corporate_client_id   INT,
    employee_id           INT,
    requisition_no        VARCHAR(100),
    reason_for_test       TEXT,
    deleted               BOOLEAN DEFAULT FALSE,
    deleted_timestamp     TIMESTAMPTZ,
    deleted_by_id         INT,
    status                BOOLEAN DEFAULT TRUE,
    user_id               INT,
    role_type_id          INT
);

CREATE TABLE IF NOT EXISTS test_request_employee (
    id                    SERIAL PRIMARY KEY,
    creation_timestamp    TIMESTAMPTZ DEFAULT NOW(),
    created_by_id         INT,
    b2b_client_id         INT,
    test_request_id       INT REFERENCES test_request(id),
    employee_id           INT REFERENCES employees(id),
    deleted               BOOLEAN DEFAULT FALSE,
    deleted_timestamp     TIMESTAMPTZ,
    deleted_by_id         INT,
    status                BOOLEAN DEFAULT TRUE,
    user_id               INT,
    role_type_id          INT
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_patient_b2b_client ON patient(b2b_client_id);
CREATE INDEX IF NOT EXISTS idx_patient_name ON patient(name);
CREATE INDEX IF NOT EXISTS idx_patient_mobile ON patient(mobile);
CREATE INDEX IF NOT EXISTS idx_drug_test_patient ON drug_test(patient_id);
CREATE INDEX IF NOT EXISTS idx_alcohol_test_patient ON alcohol_test(patient_id);
CREATE INDEX IF NOT EXISTS idx_covid_test_patient ON covid_test(patient_id);
CREATE INDEX IF NOT EXISTS idx_tb_test_patient ON tb_test(patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_test_cat_report_patient ON lab_test_category_report(patient_id);
CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);
CREATE INDEX IF NOT EXISTS idx_waiting_list_patient ON waiting_list(patient_id);
