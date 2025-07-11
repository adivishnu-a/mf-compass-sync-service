const { Pool } = require('pg');
require('dotenv').config();

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function flushDatabase() {
  console.log('🗑️  Starting database flush operation...');
  console.log('⚠️  WARNING: This will completely delete ALL data and tables!');
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    console.log('Step 1: Dropping tables...');
    
    // Drop both tables
    await client.query('DROP TABLE IF EXISTS funds CASCADE');
    console.log('  ✅ Dropped funds table');
    
    await client.query('DROP TABLE IF EXISTS category_averages CASCADE');
    console.log('  ✅ Dropped category_averages table');
    
    console.log('Step 2: Dropping indexes...');
    
    // Drop indexes for funds table
    const fundsIndexQueries = [
      'DROP INDEX IF EXISTS idx_funds_kuvera_code CASCADE',
      'DROP INDEX IF EXISTS idx_funds_isin CASCADE',
      'DROP INDEX IF EXISTS idx_funds_fund_category CASCADE',
      'DROP INDEX IF EXISTS idx_funds_fund_house CASCADE',
      'DROP INDEX IF EXISTS idx_funds_fund_type CASCADE',
      'DROP INDEX IF EXISTS idx_funds_total_score CASCADE'
    ];
    
    // Drop indexes for category_averages table
    const categoryIndexQueries = [
      'DROP INDEX IF EXISTS idx_category_averages_category_name CASCADE',
      'DROP INDEX IF EXISTS idx_category_averages_report_date CASCADE'
    ];
    
    const allIndexQueries = [...fundsIndexQueries, ...categoryIndexQueries];
    
    for (const query of allIndexQueries) {
      try {
        await client.query(query);
      } catch (error) {
        // Ignore errors for non-existent indexes
      }
    }
    console.log('  ✅ Cleaned up indexes');
    
    console.log('Step 3: Dropping sequences...');
    
    // Drop sequences created with SERIAL columns
    await client.query('DROP SEQUENCE IF EXISTS funds_id_seq CASCADE');
    await client.query('DROP SEQUENCE IF EXISTS category_averages_id_seq CASCADE');
    console.log('  ✅ Cleaned up sequences');
    
    console.log('Step 4: Verifying clean state...');
    
    // Verify that all objects have been removed
    const remainingTables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND (table_name LIKE 'funds%' OR table_name LIKE 'category_averages%')
    `);
    
    if (remainingTables.rows.length === 0) {
      console.log('  ✅ No remaining fund-related tables found');
    } else {
      console.log('  ⚠️  Found remaining tables:');
      remainingTables.rows.forEach(row => {
        console.log(`    - ${row.table_name}`);
      });
    }
    
    await client.query('COMMIT');
    
    console.log('\n🎉 Database flush completed successfully!');
    console.log('📊 Summary:');
    console.log('  • funds table deleted');
    console.log('  • category_averages table deleted');
    console.log('  • All indexes removed');
    console.log('  • Sequences cleaned up');
    console.log('  • Database is now completely clean');
    console.log('\n💡 You can now run the seeder to recreate the database:');
    console.log('   npm run seed');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error during database flush:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function confirmFlush() {
  console.log('\n🚨 DATABASE FLUSH CONFIRMATION 🚨');
  console.log('=====================================');
  console.log('This operation will:');
  console.log('• Delete funds table with ALL data');
  console.log('• Remove ALL indexes');
  console.log('• Drop ALL sequences');
  console.log('• This action CANNOT be undone!');
  console.log('=====================================');
  
  // Since this is a utility script, we'll proceed directly
  // In a production environment, you might want to add interactive confirmation
  console.log('⏳ Proceeding with database flush in 3 seconds...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  return true;
}

// Main execution
async function main() {
  try {
    console.log('🔧 MF Compass Database Flush Utility');
    console.log('====================================');
    
    const confirmed = await confirmFlush();
    
    if (confirmed) {
      await flushDatabase();
    } else {
      console.log('❌ Database flush cancelled');
    }
    
  } catch (error) {
    console.error('💥 Database flush failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
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