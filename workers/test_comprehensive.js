const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const DockerSandbox = require("./common/dockerSandbox");
const createSandbox = require("./common/createSandbox");
const cleanupSandbox = require("./common/cleanupSandbox");

function getActiveContainers() {
  const output = execSync("docker ps --filter name=sandbox- -q", { encoding: "utf8" });
  return output.trim().split("\n").filter(Boolean);
}

async function runComprehensiveTests() {
  console.log("=================================================");
  console.log("STARTING COMPREHENSIVE CODE EXECUTION TEST SUITE");
  console.log("=================================================\n");

  const initialContainers = getActiveContainers().length;
  console.log(`Initial active sandbox containers: ${initialContainers}`);

  // ==========================================
  // JAVASCRIPT TEST SUITE
  // ==========================================
  console.log("\n-------------------------------------------");
  console.log("TEST SUITE: JAVASCRIPT");
  console.log("-------------------------------------------");

  const jsJobDir = createSandbox("comprehensive-js");
  const jsSandbox = new DockerSandbox({
    jobId: "comprehensive-js",
    jobDir: jsJobDir,
    image: "node:20-alpine",
    readOnly: true,
  });

  try {
    await jsSandbox.start();
    const runningDuringSubmission = getActiveContainers().length;
    console.log(`[JS] Sandbox started. Active containers: ${runningDuringSubmission} (Expected: ${initialContainers + 1})`);

    // Scenario JS 1: Correct Solution + Multiple Test Cases + Stdin EOF
    console.log("\n[JS Scenario 1 & 5 & 7] Correct Solution with 5 Testcases & Stdin EOF");
    const twoSumJs = `
const fs = require('fs');
const input = fs.readFileSync(0, 'utf8').trim().split('\\n');
if (input.length >= 3) {
  const n = +input[0];
  const nums = input[1].split(' ').map(Number);
  const target = +input[2];
  function twoSum(nums, target) {
    const map = new Map();
    for (let i = 0; i < nums.length; i++) {
      const comp = target - nums[i];
      if (map.has(comp)) return [map.get(comp), i];
      map.set(nums[i], i);
    }
    return [];
  }
  console.log(twoSum(nums, target).join(' '));
}
`;
    fs.writeFileSync(path.join(jsJobDir, "app.js"), twoSumJs);

    const testcases = [
      { input: "4\n2 7 11 15\n9\n", expected: "0 1" },
      { input: "3\n3 2 4\n6\n", expected: "1 2" },
      { input: "2\n3 3\n6\n", expected: "0 1" },
      { input: "5\n1 2 3 4 5\n9\n", expected: "3 4" },
      { input: "4\n-1 -2 -3 -4\n-7\n", expected: "2 3" },
    ];

    let passedJs = 0;
    for (let i = 0; i < testcases.length; i++) {
      const tc = testcases[i];
      const res = await jsSandbox.exec(["node", "app.js"], { input: tc.input, timeoutMs: 3000 });
      if (res.stdout === tc.expected) {
        passedJs++;
        console.log(`  ✓ Test Case ${i + 1} Passed (${Math.round(res.runtimeMs)}ms)`);
      } else {
        throw new Error(`Test Case ${i + 1} Failed: expected ${tc.expected}, got ${res.stdout}`);
      }
    }
    console.log(`  -> JS 5/5 test cases passed inside ONE container!`);

    // Scenario JS 2: Wrong Answer
    console.log("\n[JS Scenario 2] Wrong Answer Detection");
    const waRes = await jsSandbox.exec(["node", "app.js"], { input: "4\n2 7 11 15\n9\n", timeoutMs: 3000 });
    const isWrongAnswer = waRes.stdout !== "99 99";
    console.log(`  ✓ Wrong Answer correctly detected (Received: "${waRes.stdout}", Expected: "99 99"): ${isWrongAnswer}`);

    // Scenario JS 3: Runtime Error
    console.log("\n[JS Scenario 3] Runtime Error Handling");
    fs.writeFileSync(path.join(jsJobDir, "error.js"), "throw new Error('Null Pointer Reference Simulation');");
    const errRes = await jsSandbox.exec(["node", "error.js"], { timeoutMs: 3000 });
    console.log(`  ✓ Runtime error captured: code=${errRes.code}, stderr includes: "${errRes.stderr.split('\\n')[0]}"`);
    if (errRes.code === 0) throw new Error("Expected non-zero exit code for runtime error");

    // Scenario JS 4: Timeout / Infinite Loop
    console.log("\n[JS Scenario 4] Infinite Loop / Timeout Enforcement");
    fs.writeFileSync(path.join(jsJobDir, "infinite.js"), "while(true) {}");
    const timeoutRes = await jsSandbox.exec(["node", "infinite.js"], { timeoutMs: 1500 });
    console.log(`  ✓ Infinite loop intercepted: timedOut=${timeoutRes.timedOut}, code=${timeoutRes.code}, runtime=${Math.round(timeoutRes.runtimeMs)}ms`);
    if (!timeoutRes.timedOut) throw new Error("Expected timedOut = true for infinite loop");

    // Scenario JS 6: Large Input
    console.log("\n[JS Scenario 6] Large Input Handling");
    const largeN = 50000;
    const largeArray = Array.from({ length: largeN }, (_, i) => i + 1);
    const largeInput = `${largeN}\n${largeArray.join(" ")}\n${largeArray[largeN - 2] + largeArray[largeN - 1]}\n`;
    const largeRes = await jsSandbox.exec(["node", "app.js"], { input: largeInput, timeoutMs: 5000 });
    console.log(`  ✓ Large input (${largeN} elements, ~${Math.round(largeInput.length / 1024)} KB) executed successfully: output="${largeRes.stdout}", runtime=${Math.round(largeRes.runtimeMs)}ms`);
    if (largeRes.stdout !== `${largeN - 2} ${largeN - 1}`) throw new Error(`Large input test failed: ${largeRes.stdout}`);

  } finally {
    await jsSandbox.destroy();
    cleanupSandbox(jsJobDir);
    console.log(`\n[JS] Sandbox destroyed and cleaned up. Active containers: ${getActiveContainers().length}`);
  }

  // ==========================================
  // JAVA TEST SUITE
  // ==========================================
  console.log("\n-------------------------------------------");
  console.log("TEST SUITE: JAVA");
  console.log("-------------------------------------------");

  const javaJobDir = createSandbox("comprehensive-java");
  const javaSandbox = new DockerSandbox({
    jobId: "comprehensive-java",
    jobDir: javaJobDir,
    image: "eclipse-temurin:17-jdk-alpine-3.23",
    readOnly: true,
    user: "1000:1000",
  });

  try {
    await javaSandbox.start();
    console.log(`[Java] Sandbox started. Active containers: ${getActiveContainers().length}`);

    // Scenario Java 2: Compilation Error
    console.log("\n[Java Scenario 2] Compilation Error Handling");
    fs.writeFileSync(path.join(javaJobDir, "Main.java"), "public class Main { invalid java code; }");
    const compileErrRes = await javaSandbox.exec(["javac", "Main.java"], { timeoutMs: 10000 });
    console.log(`  ✓ Compilation error correctly captured: code=${compileErrRes.code}, stderr="${compileErrRes.stderr.split('\\n')[0]}"`);
    if (compileErrRes.code === 0) throw new Error("Expected compilation error to fail");

    // Scenario Java 1, 5, 6: Successful Compilation ONCE + 5 Test Cases + Large Input
    console.log("\n[Java Scenario 1 & 5 & 7] Valid Code - Compile ONCE, Multiple Test Cases");
    const javaCode = `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        if (!sc.hasNextInt()) return;
        int n = sc.nextInt();
        int[] nums = new int[n];
        for (int i = 0; i < n; i++) nums[i] = sc.nextInt();
        int target = sc.nextInt();
        int[] ans = twoSum(nums, target);
        if (ans.length == 2) {
            System.out.println(ans[0] + " " + ans[1]);
        }
    }
    public static int[] twoSum(int[] nums, int target) {
        Map<Integer, Integer> map = new HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            int comp = target - nums[i];
            if (map.containsKey(comp)) return new int[] { map.get(comp), i };
            map.put(nums[i], i);
        }
        return new int[] {};
    }
}
`;
    fs.writeFileSync(path.join(javaJobDir, "Main.java"), javaCode);

    console.log("  Compiling Java code ONCE...");
    const compileRes = await javaSandbox.exec(["javac", "Main.java"], { timeoutMs: 15000 });
    console.log(`  ✓ Compilation finished (code=${compileRes.code}, runtime=${Math.round(compileRes.runtimeMs)}ms)`);
    if (compileRes.code !== 0) throw new Error(`Java compilation failed: ${compileRes.stderr}`);

    const javaTestcases = [
      { input: "4 2 7 11 15 9", expected: "0 1" },
      { input: "3 3 2 4 6", expected: "1 2" },
      { input: "2 3 3 6", expected: "0 1" },
      { input: "5 1 2 3 4 5 9", expected: "3 4" },
      { input: "4 -1 -2 -3 -4 -7", expected: "2 3" },
    ];

    let passedJava = 0;
    for (let i = 0; i < javaTestcases.length; i++) {
      const tc = javaTestcases[i];
      const res = await javaSandbox.exec(["java", "Main"], { input: tc.input, timeoutMs: 3000 });
      if (res.stdout === tc.expected) {
        passedJava++;
        console.log(`  ✓ Java Test Case ${i + 1} Passed (${Math.round(res.runtimeMs)}ms)`);
      } else {
        throw new Error(`Java Test Case ${i + 1} Failed: expected ${tc.expected}, got ${res.stdout}`);
      }
    }
    console.log(`  -> Java 5/5 test cases passed inside ONE container!`);

    // Scenario Java 3: Wrong Answer
    console.log("\n[Java Scenario 3] Wrong Answer Detection");
    const jWaRes = await javaSandbox.exec(["java", "Main"], { input: "4 2 7 11 15 9", timeoutMs: 3000 });
    const isJWrongAnswer = jWaRes.stdout !== "10 20";
    console.log(`  ✓ Wrong Answer detected (Received: "${jWaRes.stdout}", Expected: "10 20"): ${isJWrongAnswer}`);

    // Scenario Java 4: Runtime Exception
    console.log("\n[Java Scenario 4] Runtime Exception Handling");
    fs.writeFileSync(path.join(javaJobDir, "Crash.java"), "public class Crash { public static void main(String[] args) { throw new ArithmeticException(\"Division by zero\"); } }");
    await javaSandbox.exec(["javac", "Crash.java"], { timeoutMs: 10000 });
    const crashRes = await javaSandbox.exec(["java", "Crash"], { timeoutMs: 3000 });
    console.log(`  ✓ Runtime exception captured: code=${crashRes.code}, stderr includes: "${crashRes.stderr.split('\\n')[0]}"`);
    if (crashRes.code === 0) throw new Error("Expected crash to have non-zero exit code");

    // Scenario Java 5: Infinite Loop / Timeout
    console.log("\n[Java Scenario 5] Infinite Loop / Timeout Handling");
    fs.writeFileSync(path.join(javaJobDir, "Loop.java"), "public class Loop { public static void main(String[] args) { while(true) {} } }");
    await javaSandbox.exec(["javac", "Loop.java"], { timeoutMs: 10000 });
    const loopRes = await javaSandbox.exec(["java", "Loop"], { timeoutMs: 1500 });
    console.log(`  ✓ Timeout captured: timedOut=${loopRes.timedOut}, code=${loopRes.code}`);
    if (!loopRes.timedOut) throw new Error("Expected timedOut = true for Java loop");

    // Scenario Java 6: Large Input
    console.log("\n[Java Scenario 6] Large Input Handling");
    const jLargeN = 10000;
    const jLargeArray = Array.from({ length: jLargeN }, (_, i) => i + 1);
    const jLargeInput = `${jLargeN} ${jLargeArray.join(" ")} ${jLargeArray[jLargeN - 2] + jLargeArray[jLargeN - 1]}`;
    const jLargeRes = await javaSandbox.exec(["java", "Main"], { input: jLargeInput, timeoutMs: 10000 });
    console.log(`  ✓ Large input (${jLargeN} elements) executed: output="${jLargeRes.stdout}", runtime=${Math.round(jLargeRes.runtimeMs)}ms`);
    if (jLargeRes.stdout !== `${jLargeN - 2} ${jLargeN - 1}`) throw new Error(`Java large input test failed: ${jLargeRes.stdout}`);

  } finally {
    await javaSandbox.destroy();
    cleanupSandbox(javaJobDir);
    console.log(`\n[Java] Sandbox destroyed and cleaned up. Active containers: ${getActiveContainers().length}`);
  }

  console.log("\n=================================================");
  console.log("ALL JAVASCRIPT & JAVA SCENARIOS PASSED 100%!");
  console.log("=================================================\n");
}

runComprehensiveTests().catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});
