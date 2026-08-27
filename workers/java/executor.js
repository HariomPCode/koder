const path = require("path");
const { generateJavaRunner } = require("@koder/shared");
const { createExecutionExecutor } = require("../common/executionEngine");

const config = {
  language: "java",
  image: "eclipse-temurin:17-jdk-alpine-3.23",
  readOnly: false,
  sourceFile: "Main.java",
  execCommand: ["java", "Main"],
  compile: {
    command: ["javac", "Main.java"],
    timeoutMs: 25000,
  },
  templateDirectory: path.resolve(__dirname, "../templates/java"),
  templateExtension: "java",
  generateRunner: generateJavaRunner,
};

const executor = createExecutionExecutor(config);
executor.config = config;

module.exports = executor;
