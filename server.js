require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { pool } = require('./db');
const { getDatabaseLabel, isManagedDatabase } = require('./dbConfig');
const { runStartupMigrations } = require('./utils/runMigrations');

const labTestReportRoutes = require('./routes/labTestReport');

const path = require('path');
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Core Routes ──────────────────────────────────────────────
const authRouter             = require('./routes/auth');
const adminUsersRouter       = require('./routes/adminUsers');
const superAdminRouter       = require('./routes/superAdmin');
const patientRouter          = require('./routes/patient');
const labTestsRouter         = require('./routes/labTests');
const b2bClientsRouter            = require('./routes/b2bClients');
const corporateClientsRouter      = require('./routes/corporateClients');
const b2bClientSubscriptionRouter = require('./routes/b2bClientSubscription');
const b2bClientLabTestAccessRouter= require('./routes/b2bClientLabTestAccess');
const { crudRoutes }              = require('./routes/crud');
const waitingListRouter                = require('./routes/waitingList');
const specimenTypeDrugLinkingRouter    = require('./routes/specimenTypeDrugLinking');

app.use('/api/Auth',             authRouter);
app.use('/api/AdminUsers',       adminUsersRouter);
app.use('/api/SuperAdmin', superAdminRouter);
app.use('/api/Patient', patientRouter);
app.use('/api/LabTests', labTestsRouter);
app.use('/api/B2bClients', b2bClientsRouter);
app.use('/api/CorporateClients', corporateClientsRouter);
app.use('/api/B2bClientDocument', require('./routes/b2bClientDocument'));
app.use('/api/B2bClientSubscription', b2bClientSubscriptionRouter);
app.use('/api/B2bClientLabTestAccess', b2bClientLabTestAccessRouter);
app.use('/api/B2bClientCustomPrices', require('./routes/b2bClientCustomPrices'));
app.use('/api/LabTestReport', labTestReportRoutes);
app.use('/api/AdultHealthCertificates', require('./routes/adultHealthCertificates'));
app.use('/api/PhysicalExaminationCertificates', require('./routes/physicalExaminationCertificates'));

// ── Generic CRUD Routes (table name mapped) ──────────────────
app.use('/api/Employees', crudRoutes('employees'));
app.use('/api/DrugTest', crudRoutes('drug_test'));
app.use('/api/DrugTestDrugs', crudRoutes('drug_test_drugs'));
app.use('/api/Drugs', crudRoutes('drugs'));
app.use('/api/AlcoholTest', crudRoutes('alcohol_test'));
app.use('/api/CovidTest', crudRoutes('covid_test'));
app.use('/api/TbTest', crudRoutes('tb_test'));
app.use('/api/WaitingList', waitingListRouter);
app.use('/api/WaitingTestLabTest', crudRoutes('waiting_test_lab_test'));
app.use('/api/SpecimenType', crudRoutes('specimen_type'));
app.use('/api/SpecimenTypeDrugLinking', specimenTypeDrugLinkingRouter);
app.use('/api/LabTestCategoryReport', require('./routes/labTestCategoryReport'));
app.use('/api/ReportQuestions', crudRoutes('report_questions'));
app.use('/api/TestRequest', require('./routes/testRequestBulk'));
app.use('/api/ReportRequestParameters', crudRoutes('report_request_parameters'));
app.use('/api/GlobalSettings', require('./routes/globalSettings'));
app.use('/api/Country', crudRoutes('country'));
app.use('/api/State', crudRoutes('state'));
app.use('/api/City', crudRoutes('city'));
app.use('/api/District', crudRoutes('district'));
app.use('/api/Region', crudRoutes('region'));
app.use('/api/RoleTypes', crudRoutes('role_types'));
app.use('/api/ActionNames', crudRoutes('action_names'));
app.use('/api/TypeData', crudRoutes('document_type'));
app.use('/api/ServiceType', crudRoutes('service_type'));
app.use('/api/MedicalOfficer', crudRoutes('medical_officer'));
app.use('/api/CovidDescription', crudRoutes('covid_description'));

// ── Health Check ─────────────────────────────────────────────
app.get('/health', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW() as time');
        res.json({ status: 'ok', db: 'connected', time: result.rows[0].time });
    } catch (err) {
        res.status(500).json({ status: 'error', db: 'disconnected', error: err.message });
    }
});

// ── Start Server (migrations first) ──────────────────────────
const PORT = process.env.PORT || 5000;

async function start() {
    try {
        await runStartupMigrations();
    } catch (err) {
        console.error('❌ Startup migration failed:', err.message);
        process.exit(1);
    }

    app.listen(PORT, () => {
        console.log(`✅ Metrolab Node.js API running on http://localhost:${PORT}`);
        console.log(`🔗 Database: ${getDatabaseLabel()}`);
        if (!isManagedDatabase()) {
            console.log(`📋 Fresh DB setup: npm run migrate`);
        }
    });
}

start();
