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
      console.log('⚠️  No MongoDB URI found. Running in memory-only mode.');
      console.log('   Add MONGODB_URI to .env for database persistence.');
      return false;
    }
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    console.log('⚠️  Falling back to in-memory mode');
    return false;
  }
};

module.exports = connectDB;
