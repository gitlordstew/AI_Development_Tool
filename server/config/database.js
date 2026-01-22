const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // If MongoDB URL is provided, connect to database
    if (process.env.MONGODB_URI) {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log('✅ MongoDB connected successfully');
      console.log(`📊 Database: ${mongoose.connection.name}`);
      return true;
    } else {
      const allowInMemory = String(process.env.ALLOW_IN_MEMORY || '').toLowerCase() === 'true';
      if (allowInMemory) {
        console.log('⚠️  No MongoDB URI found. Running in memory-only mode (ALLOW_IN_MEMORY=true).');
        console.log('   Add MONGODB_URI to .env for database persistence.');
        return false;
      }

      console.error('❌ No MongoDB URI found. MongoDB is required for this deployment.');
      console.error('   Set MONGODB_URI in .env (or set ALLOW_IN_MEMORY=true to bypass).');
      throw new Error('MONGODB_URI is required');
    }
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    const allowInMemory = String(process.env.ALLOW_IN_MEMORY || '').toLowerCase() === 'true';
    if (allowInMemory) {
      console.log('⚠️  Falling back to in-memory mode (ALLOW_IN_MEMORY=true)');
      return false;
    }
    throw error;
  }
};

module.exports = connectDB;
