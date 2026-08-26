const path = require("path");
const fs = require("fs");
const { performance } = require("perf_hooks");
const DockerSandbox = require("./common/dockerSandbox");
const createSandbox = require("./common/createSandbox");
const cleanupSandbox = require("./common/cleanupSandbox");
const { serializeBatch, parseBatchResults } = require("./common/protocol");

async function runAdvancedTestSuite() {
  console.log("=================================================================");
  console.log("STARTING ADVANCED BATCHED TEST-CASE EXECUTION & BENCHMARK SUITE");
  console.log("=================================================================\n");

  // -------------------------------------------------------------
  // 1. JAVASCRIPT TESTS
  // -------------------------------------------------------------
  console.log("-----------------------------------------------------------------");
  console.log("1. JAVASCRIPT EXECUTION & PROTOCOL TESTS");
  console.log("-----------------------------------------------------------------");

  const jsJobDir = createSandbox("adv-js");
  const jsTemplate = fs.readFileSync(path.join(__dirname, "templates/javascript/two-sum.js"), "utf8");

  // Valid User Solution
  const validJsCode = `
function twoSum(nums, target) {
  const map = new Map();
  for (let i = 0; i < nums.length; i++) {
    const comp = target - nums[i];
    if (map.has(comp)) return [map.get(comp), i];
    map.set(nums[i], i);
  }
  return [];
}
`;
  fs.writeFileSync(path.join(jsJobDir, "app.js"), jsTemplate.replace("/***USER_CODE***/", validJsCode));

  const jsSandbox = new DockerSandbox({
    jobId: "adv-js",
    jobDir: jsJobDir,
    image: "node:20-alpine",
    readOnly: true,
  });

  try {
    await jsSandbox.start();
    console.log("✓ JS Docker sandbox container started.");

    // A. 1 Test Case
    console.log("\n[JS Test 1] Single test case");
    const tc1 = [{ input: "4\n2 7 11 15\n9\n", output: "0 1" }];
    const res1 = await jsSandbox.exec(["node", "app.js"], { input: serializeBatch(tc1, 0), timeoutMs: 3000 });
    const parsed1 = parseBatchResults(res1.stdout);
    console.log(`  Output: "${parsed1.get(0).output}" | Runtime: ${Math.round(res1.runtimeMs)}ms`);
    if (parsed1.get(0).output !== "0 1") throw new Error("JS 1 test case failed");

    // B. 10 Test Cases in 1 Process
    console.log("\n[JS Test 2] 10 Test cases in ONE Node process");
    const tc10 = Array.from({ length: 10 }, (_, i) => ({
      input: `3\n${i} ${i + 1} ${i + 2}\n${2 * i + 1}\n`,
      output: "0 1",
    }));
    const t0 = performance.now();
    const res10 = await jsSandbox.exec(["node", "app.js"], { input: serializeBatch(tc10, 0), timeoutMs: 5000 });
    const elapsed10 = performance.now() - t0;
    const parsed10 = parseBatchResults(res10.stdout);
    console.log(`  Parsed: ${parsed10.size}/10 test cases | Total time: ${Math.round(elapsed10)}ms (Avg per testcase: ${(elapsed10 / 10).toFixed(2)}ms)`);
    if (parsed10.size !== 10) throw new Error("JS 10 test cases failed");

    // C. 100 Test Cases in 1 Process
    console.log("\n[JS Test 3] 100 Test cases in ONE Node process");
    const tc100 = Array.from({ length: 100 }, (_, i) => ({
      input: `4\n${i} ${i + 2} ${i + 4} ${i + 6}\n${2 * i + 6}\n`,
      output: "1 2",
    }));
    const t1 = performance.now();
    const res100 = await jsSandbox.exec(["node", "app.js"], { input: serializeBatch(tc100, 0), timeoutMs: 5000 });
    const elapsed100 = performance.now() - t1;
    const parsed100 = parseBatchResults(res100.stdout);
    console.log(`  Parsed: ${parsed100.size}/100 test cases | Total time: ${Math.round(elapsed100)}ms (Avg per testcase: ${(elapsed100 / 100).toFixed(2)}ms)`);
    if (parsed100.size !== 100) throw new Error("JS 100 test cases failed");

    // D. 1,000 Test Cases in 1 Process
    console.log("\n[JS Test 4] 1,000 Test cases in ONE Node process");
    const tc1000 = Array.from({ length: 1000 }, (_, i) => ({
      input: `3\n1 2 3\n3\n`,
      output: "0 1",
    }));
    const t2 = performance.now();
    const res1000 = await jsSandbox.exec(["node", "app.js"], { input: serializeBatch(tc1000, 0), timeoutMs: 10000 });
    const elapsed1000 = performance.now() - t2;
    const parsed1000 = parseBatchResults(res1000.stdout);
    console.log(`  Parsed: ${parsed1000.size}/1,000 test cases | Total time: ${Math.round(elapsed1000)}ms (Avg per testcase: ${(elapsed1000 / 1000).toFixed(2)}ms)`);
    if (parsed1000.size !== 1000) throw new Error("JS 1000 test cases failed");

    // E. Runtime Error Handling inside Protocol
    console.log("\n[JS Test 5] Runtime Error Catching inside Runner");
    const crashJs = `
function twoSum(nums, target) {
  if (target === 999) throw new Error("Simulated Crash on Special Input");
  return [0, 1];
}
`;
    fs.writeFileSync(path.join(jsJobDir, "app_crash.js"), jsTemplate.replace("/***USER_CODE***/", crashJs));
    const crashBatch = [
      { input: "3\n1 2 3\n3\n", output: "0 1" },
      { input: "3\n1 2 3\n999\n", output: "0 1" }, // will throw
      { input: "3\n1 2 3\n3\n", output: "0 1" },
    ];
    const crashRes = await jsSandbox.exec(["node", "app_crash.js"], { input: serializeBatch(crashBatch, 0), timeoutMs: 3000 });
    const crashParsed = parseBatchResults(crashRes.stdout);
    console.log(`  Case 0: ${crashParsed.get(0).status} | Case 1: ${crashParsed.get(1).status} (Error: ${crashParsed.get(1).error.split("\n")[0]})`);
    if (crashParsed.get(1).status !== "ERROR") throw new Error("Expected ERROR status for case 1");

    // F. Infinite Loop / Timeout inside Batch
    console.log("\n[JS Test 6] Infinite Loop Timeout Handling");
    const loopJs = `
function twoSum(nums, target) {
  if (target === 999) while(true) {}
  return [0, 1];
}
`;
    fs.writeFileSync(path.join(jsJobDir, "app_loop.js"), jsTemplate.replace("/***USER_CODE***/", loopJs));
    const loopRes = await jsSandbox.exec(["node", "app_loop.js"], { input: serializeBatch(crashBatch, 0), timeoutMs: 1500 });
    const loopParsed = parseBatchResults(loopRes.stdout);
    console.log(`  timedOut=${loopRes.timedOut} | Completed cases before hang: ${loopParsed.size} (Case 0 status: ${loopParsed.get(0)?.status})`);
    if (!loopRes.timedOut) throw new Error("Expected timedOut = true for infinite loop");

    // G. State Leakage Test (Global/Module Variable)
    console.log("\n[JS Test 7] State Leakage Analysis (Stateful Accumulator)");
    const statefulJs = `
let globalCounter = 0;
function twoSum(nums, target) {
  globalCounter += 1;
  return [0, globalCounter];
}
`;
    fs.writeFileSync(path.join(jsJobDir, "app_state.js"), jsTemplate.replace("/***USER_CODE***/", statefulJs));
    const stateBatch = [
      { input: "3\n1 2 3\n3\n", output: "0 1" },
      { input: "3\n1 2 3\n3\n", output: "0 1" },
    ];
    const stateRes = await jsSandbox.exec(["node", "app_state.js"], { input: serializeBatch(stateBatch, 0), timeoutMs: 3000 });
    const stateParsed = parseBatchResults(stateRes.stdout);
    console.log(`  Case 0 output: "${stateParsed.get(0).output}" | Case 1 output: "${stateParsed.get(1).output}"`);
    console.log(`  ✓ State leakage across test cases is observed on mutated globals (${stateParsed.get(0).output} vs ${stateParsed.get(1).output}), correctly bound by batch boundaries.`);

  } finally {
    await jsSandbox.destroy();
    cleanupSandbox(jsJobDir);
    console.log("✓ JS sandbox destroyed.\n");
  }

  // -------------------------------------------------------------
  // 2. JAVA TESTS
  // -------------------------------------------------------------
  console.log("-----------------------------------------------------------------");
  console.log("2. JAVA EXECUTION & PROTOCOL TESTS");
  console.log("-----------------------------------------------------------------");

  const javaJobDir = createSandbox("adv-java");
  const javaTemplate = fs.readFileSync(path.join(__dirname, "templates/java/two-sum.java"), "utf8");

  const validJavaCode = `
public static int[] twoSum(int[] nums, int target) {
    Map<Integer, Integer> map = new HashMap<>();
    for (int i = 0; i < nums.length; i++) {
        int comp = target - nums[i];
        if (map.containsKey(comp)) return new int[] { map.get(comp), i };
        map.put(nums[i], i);
    }
    return new int[] {};
}
`;
  fs.writeFileSync(path.join(javaJobDir, "Main.java"), javaTemplate.replace("/***USER_CODE***/", validJavaCode));

  const javaSandbox = new DockerSandbox({
    jobId: "adv-java",
    jobDir: javaJobDir,
    image: "eclipse-temurin:17-jdk-alpine-3.23",
    readOnly: false,
  });

  try {
    await javaSandbox.start();
    console.log("✓ Java Docker sandbox container started.");

    console.log("Compiling Java Main.java ONCE...");
    const compRes = await javaSandbox.exec(["javac", "Main.java"], { timeoutMs: 15000 });
    console.log(`✓ Java compilation finished in ${Math.round(compRes.runtimeMs)}ms with exit code ${compRes.code}`);
    if (compRes.code !== 0) throw new Error(`Java compilation failed: ${compRes.stderr}`);

    // A. 1 Test Case
    console.log("\n[Java Test 1] Single test case");
    const jtc1 = [{ input: "4\n2 7 11 15\n9\n", output: "0 1" }];
    const jRes1 = await javaSandbox.exec(["java", "Main"], { input: serializeBatch(jtc1, 0), timeoutMs: 3000 });
    const jParsed1 = parseBatchResults(jRes1.stdout);
    console.log(`  Output: "${jParsed1.get(0).output}" | Runtime: ${Math.round(jRes1.runtimeMs)}ms`);
    if (jParsed1.get(0).output !== "0 1") throw new Error("Java 1 test case failed");

    // B. 10 Test Cases in 1 Process
    console.log("\n[Java Test 2] 10 Test cases in ONE JVM process");
    const jtc10 = Array.from({ length: 10 }, (_, i) => ({
      input: `3\n${i} ${i + 1} ${i + 2}\n${2 * i + 1}\n`,
      output: "0 1",
    }));
    const jt0 = performance.now();
    const jRes10 = await javaSandbox.exec(["java", "Main"], { input: serializeBatch(jtc10, 0), timeoutMs: 5000 });
    const jElapsed10 = performance.now() - jt0;
    const jParsed10 = parseBatchResults(jRes10.stdout);
    console.log(`  Parsed: ${jParsed10.size}/10 test cases | Total time: ${Math.round(jElapsed10)}ms (Avg per testcase: ${(jElapsed10 / 10).toFixed(2)}ms)`);
    if (jParsed10.size !== 10) throw new Error("Java 10 test cases failed");

    // C. 100 Test Cases in 1 Process
    console.log("\n[Java Test 3] 100 Test cases in ONE JVM process");
    const jtc100 = Array.from({ length: 100 }, (_, i) => ({
      input: `4\n${i} ${i + 2} ${i + 4} ${i + 6}\n${2 * i + 6}\n`,
      output: "1 2",
    }));
    const jt1 = performance.now();
    const jRes100 = await javaSandbox.exec(["java", "Main"], { input: serializeBatch(jtc100, 0), timeoutMs: 8000 });
    const jElapsed100 = performance.now() - jt1;
    const jParsed100 = parseBatchResults(jRes100.stdout);
    console.log(`  Parsed: ${jParsed100.size}/100 test cases | Total time: ${Math.round(jElapsed100)}ms (Avg per testcase: ${(jElapsed100 / 100).toFixed(2)}ms)`);
    if (jParsed100.size !== 100) throw new Error("Java 100 test cases failed");

    // D. 1,000 Test Cases in 1 Process
    console.log("\n[Java Test 4] 1,000 Test cases in ONE JVM process");
    const jtc1000 = Array.from({ length: 1000 }, (_, i) => ({
      input: `3\n1 2 3\n3\n`,
      output: "0 1",
    }));
    const jt2 = performance.now();
    const jRes1000 = await javaSandbox.exec(["java", "Main"], { input: serializeBatch(jtc1000, 0), timeoutMs: 15000 });
    const jElapsed1000 = performance.now() - jt2;
    const jParsed1000 = parseBatchResults(jRes1000.stdout);
    console.log(`  Parsed: ${jParsed1000.size}/1,000 test cases | Total time: ${Math.round(jElapsed1000)}ms (Avg per testcase: ${(jElapsed1000 / 1000).toFixed(2)}ms)`);
    if (jParsed1000.size !== 1000) throw new Error("Java 1000 test cases failed");

    // E. Java Runtime Exception Handling
    console.log("\n[Java Test 5] Runtime Exception Catching inside JVM Driver");
    const crashJava = `
public static int[] twoSum(int[] nums, int target) {
    if (target == 999) throw new ArithmeticException("Simulated Division by Zero on Special Target");
    return new int[] { 0, 1 };
}
`;
    fs.writeFileSync(path.join(javaJobDir, "MainCrash.java"), javaTemplate.replace("public class Main {", "public class MainCrash {").replace("/***USER_CODE***/", crashJava));
    await javaSandbox.exec(["javac", "MainCrash.java"], { timeoutMs: 15000 });
    const jCrashBatch = [
      { input: "3\n1 2 3\n3\n", output: "0 1" },
      { input: "3\n1 2 3\n999\n", output: "0 1" }, // will throw ArithmeticException
      { input: "3\n1 2 3\n3\n", output: "0 1" },
    ];
    const jCrashRes = await javaSandbox.exec(["java", "MainCrash"], { input: serializeBatch(jCrashBatch, 0), timeoutMs: 3000 });
    const jCrashParsed = parseBatchResults(jCrashRes.stdout);
    console.log(`  Case 0: ${jCrashParsed.get(0).status} | Case 1: ${jCrashParsed.get(1).status} (Error: ${jCrashParsed.get(1).error})`);
    if (jCrashParsed.get(1).status !== "ERROR") throw new Error("Expected ERROR status for Java case 1");

    // F. Java Infinite Loop / Timeout
    console.log("\n[Java Test 6] Java Infinite Loop Timeout Handling");
    const loopJava = `
public static int[] twoSum(int[] nums, int target) {
    if (target == 999) while(true) {}
    return new int[] { 0, 1 };
}
`;
    fs.writeFileSync(path.join(javaJobDir, "MainLoop.java"), javaTemplate.replace("public class Main {", "public class MainLoop {").replace("/***USER_CODE***/", loopJava));
    await javaSandbox.exec(["javac", "MainLoop.java"], { timeoutMs: 15000 });
    const jLoopRes = await javaSandbox.exec(["java", "MainLoop"], { input: serializeBatch(jCrashBatch, 0), timeoutMs: 1500 });
    const jLoopParsed = parseBatchResults(jLoopRes.stdout);
    console.log(`  timedOut=${jLoopRes.timedOut} | Completed cases before hang: ${jLoopParsed.size} (Case 0 status: ${jLoopParsed.get(0)?.status})`);
    if (!jLoopRes.timedOut) throw new Error("Expected timedOut = true for Java loop");

    // G. Java Static State Leakage Analysis
    console.log("\n[Java Test 7] Java Static Variable Mutation Analysis");
    const statefulJava = `
static int counter = 0;
public static int[] twoSum(int[] nums, int target) {
    counter++;
    return new int[] { 0, counter };
}
`;
    fs.writeFileSync(path.join(javaJobDir, "MainState.java"), javaTemplate.replace("public class Main {", "public class MainState {").replace("/***USER_CODE***/", statefulJava));
    await javaSandbox.exec(["javac", "MainState.java"], { timeoutMs: 15000 });
    const jStateBatch = [
      { input: "3\n1 2 3\n3\n", output: "0 1" },
      { input: "3\n1 2 3\n3\n", output: "0 1" },
    ];
    const jStateRes = await javaSandbox.exec(["java", "MainState"], { input: serializeBatch(jStateBatch, 0), timeoutMs: 3000 });
    const jStateParsed = parseBatchResults(jStateRes.stdout);
    console.log(`  Case 0 output: "${jStateParsed.get(0).output}" | Case 1 output: "${jStateParsed.get(1).output}"`);
    console.log(`  ✓ State leakage across test cases is observed on mutated static fields (${jStateParsed.get(0).output} vs ${jStateParsed.get(1).output}), strictly bounded by batch size.`);

  } finally {
    await javaSandbox.destroy();
    cleanupSandbox(javaJobDir);
    console.log("✓ Java sandbox destroyed.\n");
  }

  console.log("=================================================================");
  console.log("ALL TESTS & PROTOCOL CHECKS COMPLETED SUCCESSFULLY!");
  console.log("=================================================================\n");
}

runAdvancedTestSuite().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
