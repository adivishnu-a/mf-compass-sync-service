const { Pool } = require('pg');
require('dotenv').config();

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function flushDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('Starting database flush...');
    await client.query('BEGIN');
    await client.query('DROP TABLE IF EXISTS funds CASCADE');
    await client.query('DROP TABLE IF EXISTS category_averages CASCADE');
    await client.query('COMMIT');
    console.log('Flush completed. All tables removed.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Flush failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Main execution
async function main() {
  try {
    console.log('🔧 MF Compass Database Flush Utility');
    console.log('====================================');
    
    await flushDatabase();
    
  } catch (error) {
    console.error('💥 Database flush failed:', error);
    process.exit(1);
  }
}

// Run the flush utility
if (require.main === module) {
  main()
    .then(() => {
      console.log('\n✅ Database flush utility completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Database flush utility failed:', error);
      process.exit(1);
    });
}

module.exports = { flushDatabase };