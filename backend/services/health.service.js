const mongoose = require("mongoose");
const queue = require("../queue");

function getLiveness() {
  return {
    status: "ok",
  };
}

function getReadiness({
  mongoState = mongoose.connection.readyState,
  redisHealthy = queue.connection?.status === "ready",
} = {}) {
  const dependencies = {
    mongodb: mongoState === 1,
    redis: Boolean(redisHealthy),
  };
  const ready = Object.values(dependencies).every(Boolean);

  return {
    ready,
    dependencies,
  };
}

module.exports = {
  getLiveness,
  getReadiness,
};
