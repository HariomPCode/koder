const path = require("path");
const { generateJavaScriptRunner } = require("@koder/shared");
const { createExecutionExecutor } = require("../common/executionEngine");

const config = {
  language: "javascript",
  image: "node:20-alpine",
  readOnly: true,
  user: "1000:1000",
  sourceFile: "app.js",
  execCommand: ["node", "app.js"],
  templateDirectory: path.resolve(__dirname, "../templates/javascript"),
  templateExtension: "js",
  generateRunner: generateJavaScriptRunner,
};

const executor = createExecutionExecutor(config);
executor.config = config;

module.exports = executor;
