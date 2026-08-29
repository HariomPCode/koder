const path = require("path");
const { generatePythonRunner } = require("@koder/shared");
const { createExecutionExecutor } = require("../common/executionEngine");

const config = {
  language: "python",
  image: "python:3.11-alpine",
  readOnly: true,
  user: "1000:1000",
  sourceFile: "solution.py",
  execCommand: ["python", "-u", "solution.py"],
  templateDirectory: path.resolve(__dirname, "../templates/python"),
  templateExtension: "py",
  generateRunner: generatePythonRunner,
};

const executor = createExecutionExecutor(config);
executor.config = config;

module.exports = executor;
