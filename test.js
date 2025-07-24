const { Pool } = require('pg');
require('dotenv').config();

// Import service modules
const kuveraListService = require('./kuvera-list-service');

async function testConnection() {
  console.log('🔧 MF Compass System Test & Validation\n');
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    // Test 1: Database Connection
    await testDatabaseConnection(pool);
    
    // Test 2: Kuvera API
    await testKuveraAPI();
    
    // Test 3: Fund Discovery
    await testFundDiscovery();
    
    // Test 4: Data Quality
    await testDataQuality();
    console.log('✅ All tests passed. System ready.');
    
  } catch (error) {
    console.error('❌ System test failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

async function testDatabaseConnection(pool) {
  try {
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();
    console.log('✅ Database connection OK');
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    throw error;
  }
}

async function testKuveraAPI() {
  try {
    const testResult = await kuveraListService.testConnection();
    if (testResult) {
      console.log('✅ Kuvera API OK');
    }
  } catch (error) {
    console.error('❌ Kuvera API test failed:', error.message);
    throw error;
  }
}

async function testFundDiscovery() {
  try {
    const sampleCodes = await kuveraListService.getFilteredFundCodes();
    if (sampleCodes.length === 0) throw new Error('No funds discovered');
    console.log(`✅ Fund discovery OK (${sampleCodes.length} funds)`);
  } catch (error) {
    console.error('❌ Fund discovery test failed:', error.message);
    throw error;
  }
}

async function testDataQuality() {
  try {
    const sampleCodes = await kuveraListService.getFilteredFundCodes();
    if (sampleCodes.length === 0) throw new Error('No sample funds available');
    const sampleFund = sampleCodes[0];
    const fundDetails = await kuveraListService.getFundDetails(sampleFund.code);
    const validation = kuveraListService.validateFundData(fundDetails);
    if (!validation.isValid) throw new Error(`Data validation failed: ${validation.message}`);
    console.log('✅ Sample fund data quality OK');
  } catch (error) {
    console.error('❌ Data quality test failed:', error.message);
    throw error;
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  testConnection();
}

module.exports = { testConnection };