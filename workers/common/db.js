const mongoose = require("mongoose");
const { createLogger } = require("@koder/shared");
const logger = createLogger("worker.db");

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
    logger.info({ event: "worker_mongodb_connected" });
    return mongoose.connection;
  } catch (error) {
    logger.error({ event: "worker_mongodb_connection_failed", err: error });
    throw error;
  }
}

module.exports = connectDB;
