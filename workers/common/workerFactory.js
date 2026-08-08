const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "../../backend/.env"),
});

const connectDB = require("../../backend/db");
const { Worker } = require("bullmq");
const { connection } = require("../../backend/queue");

async function createWorker(queueName, processor) {
  await connectDB();

  console.log(`Worker connected to MongoDB`);

  const worker = new Worker(queueName, processor, {
    connection,
  });

  console.log(`Worker listening on ${queueName}`);

  return worker;
}

module.exports = createWorker;
