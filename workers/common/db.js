const mongoose = require("mongoose");

async function connectDB() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not defined in worker environment");
  }
  try {
    await mongoose.connect(uri);
    console.log("Worker connected to MongoDB");
    return mongoose.connection;
  } catch (error) {
    console.error("Worker error connecting to MongoDB:", error);
    throw error;
  }
}

module.exports = connectDB;

