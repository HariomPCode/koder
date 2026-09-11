const mongoose = require("mongoose");
const { createLogger } = require("@koder/shared");
const logger = createLogger("backend.db");

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    logger.info({ event: "mongodb_connected" });
  } catch (error) {
    logger.error({ event: "mongodb_connection_failed", err: error });
  }
}

module.exports = connectDB;
