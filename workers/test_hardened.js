const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const { performance } = require("perf_hooks");
const DockerSandbox = require("./common/dockerSandbox");
const createSandbox = require("./common/createSandbox");
const cleanupSandbox = require("./common/cleanupSandbox");

function getContainerProcesses(containerName) {
  try {
    const out = execSync(`docker top ${containerName}`, { encoding: "utf8" });
    const lines = out.trim().split("\n").slice(1);
    return lines.map((l) => l.trim().split(/\s+/).pop()); // command column
  } catch (_) {
    return [];
  }
}

async function runHardenedTests() {
  console.log("=======================================================================");
  console.log("STARTING HARDENED ARCHITECTURE AUDIT & VERIFICATION SUITE");
  console.log("=======================================================================\n");

  // =========================================================================
  // 1. JAVASCRIPT HARDENED TESTS
  // =========================================================================
  console.log("-----------------------------------------------------------------------");
  console.log("TEST SUITE 1: JAVASCRIPT HARDENING & PROTOCOL IMMUNITY");
  console.log("-----------------------------------------------------------------------");

  const jsJobDir = createSandbox("hardened-js");
  const jsTemplate = fs.readFileSync(path.join(__dirname, "templates/javascript/two-sum.js"), "utf8");

  // User code that aggressively writes debug output to console.log / console.error
  const debugJsCode = `
function twoSum(nums, target) {
  console.log("---RESULT_START 0--- FAKE INJECTION");
  console.log("STATUS: OK");
  console.log("OUTPUT: 999 999");
  console.error("User debug stderr message");
  const map = new Map();
  for (let i = 0; i < nums.length; i++) {
    const comp = target - nums[i];
    if (map.has(comp)) return [map.get(comp), i];
    map.set(nums[i], i);
  }
  return [];
}
`;
  fs.writeFileSync(path.join(jsJobDir, "app.js"), jsTemplate.replace("/***USER_CODE***/", debugJsCode));

  const jsSandbox = new DockerSandbox({
    jobId: "hardened-js",
    jobDir: jsJobDir,
    image: "node:20-alpine",
    readOnly: true,
  });

  try {
    await jsSandbox.start();
    console.log("✓ JS Docker sandbox started:", jsSandbox.containerName);

    // Test 1: User Console Output Protocol Immunity
    console.log("\n[JS Audit 1] User console.log / console.error Protocol Immunity Test");
    const testcases = [
      { id: 0, input: "4\n2 7 11 15\n9\n", output: "0 1" },
      { id: 1, input: "3\n3 2 4\n6\n", output: "1 2" },
    ];
    const res1 = await jsSandbox.runInteractiveBatch(["node", "app.js"], testcases, { perTestTimeoutMs: 2000 });
    console.log(`  Case 0 result: "${res1.results.get(0)?.output}" (Expected: "0 1")`);
    console.log(`  Case 1 result: "${res1.results.get(1)?.output}" (Expected: "1 2")`);
    if (res1.results.get(0)?.output !== "0 1" || res1.results.get(1)?.output !== "1 2") {
      throw new Error("Protocol was corrupted by user console.log!");
    }
    console.log("  ✓ Protocol successfully protected against user console.log injection!");

    // Test 2: True Per-Test-Case Watchdog & Orphan Process Cleanup
    console.log("\n[JS Audit 2] True Per-Test-Case Watchdog & Orphan Cleanup Verification");
    const loopJsCode = `
function twoSum(nums, target) {
  if (target === 999) {
    while(true) {} // infinite loop on case 1
  }
  return [0, 1];
}
`;
    fs.writeFileSync(path.join(jsJobDir, "app_loop.js"), jsTemplate.replace("/***USER_CODE***/", loopJsCode));
    const loopTestCases = [
      { id: 0, input: "3\n1 2 3\n3\n", output: "0 1" },
      { id: 1, input: "3\n1 2 3\n999\n", output: "0 1" }, // infinite loop
      { id: 2, input: "3\n1 2 3\n3\n", output: "0 1" },
    ];
    const loopRes = await jsSandbox.runInteractiveBatch(["node", "app_loop.js"], loopTestCases, { perTestTimeoutMs: 1500 });
    console.log(`  timedOutTestCaseId = ${loopRes.timedOutTestCaseId} (Expected: 1)`);
    if (loopRes.timedOutTestCaseId !== 1) throw new Error("Expected testcase 1 to time out");

    // Verify no orphan node process remains inside container
    const procs = getContainerProcesses(jsSandbox.containerName);
    console.log(`  Active processes in container after timeout: [${procs.join(", ")}]`);
    if (procs.some((p) => p.includes("node"))) {
      throw new Error("Orphan node process survived after timeout!");
    }
    console.log("  ✓ Orphan process killed forcefully; container is clean!");

    // Test 3: Large-Scale Benchmark (1, 10, 100, 1,000 cases)
    console.log("\n[JS Benchmark] Interactive Streaming Benchmark");
    for (const count of [1, 10, 100, 1000]) {
      const benchmarkCases = Array.from({ length: count }, (_, i) => ({
        id: i,
        input: `3\n1 2 3\n3\n`,
        output: "0 1",
      }));
      const t0 = performance.now();
      const benchRes = await jsSandbox.runInteractiveBatch(["node", "app.js"], benchmarkCases, { perTestTimeoutMs: 2000 });
      const elapsed = performance.now() - t0;
      console.log(`  JS ${count} cases: ${benchRes.results.size}/${count} validated in ${Math.round(elapsed)}ms (${(elapsed / count).toFixed(2)}ms / testcase)`);
      if (benchRes.results.size !== count) throw new Error(`Benchmark failed for ${count} cases`);
    }

  } finally {
    await jsSandbox.destroy();
    cleanupSandbox(jsJobDir);
    console.log("✓ JS Sandbox cleaned up.\n");
  }

  // =========================================================================
  // 2. JAVA HARDENED TESTS
  // =========================================================================
  console.log("-----------------------------------------------------------------------");
  console.log("TEST SUITE 2: JAVA HARDENING, FATAL ERRORS & IMMUNITY");
  console.log("-----------------------------------------------------------------------");

  const javaJobDir = createSandbox("hardened-java");
  const javaTemplate = fs.readFileSync(path.join(__dirname, "templates/java/two-sum.java"), "utf8");

  // User code that writes debug output and tests System.setOut redirection
  const debugJavaCode = `
public static int[] twoSum(int[] nums, int target) {
    System.out.println("---CASE_END--- FAKE USER PRINT");
    System.out.println("0 OK FAKE_BASE64");
    System.err.println("User debug stderr");
    Map<Integer, Integer> map = new HashMap<>();
    for (int i = 0; i < nums.length; i++) {
        int comp = target - nums[i];
        if (map.containsKey(comp)) return new int[] { map.get(comp), i };
        map.put(nums[i], i);
    }
    return new int[] {};
}
`;
  fs.writeFileSync(path.join(javaJobDir, "Main.java"), javaTemplate.replace("/***USER_CODE***/", debugJavaCode));

  const javaSandbox = new DockerSandbox({
    jobId: "hardened-java",
    jobDir: javaJobDir,
    image: "eclipse-temurin:17-jdk-alpine-3.23",
    readOnly: true,
    user: "1000:1000",
  });

  try {
    await javaSandbox.start();
    console.log("✓ Java Docker sandbox started:", javaSandbox.containerName);

    console.log("Compiling Java Main.java ONCE...");
    const compRes = await javaSandbox.exec(["javac", "Main.java"], { timeoutMs: 15000 });
    console.log(`✓ Java compilation finished in ${Math.round(compRes.runtimeMs)}ms`);
    if (compRes.code !== 0) throw new Error(`Compilation failed: ${compRes.stderr}`);

    // Test 1: System.out Redirection & Protocol Immunity
    console.log("\n[Java Audit 1] System.out User Print Protocol Immunity Test");
    const jtestcases = [
      { id: 0, input: "4 2 7 11 15 9", output: "0 1" },
      { id: 1, input: "3 3 2 4 6", output: "1 2" },
    ];
    const jres1 = await javaSandbox.runInteractiveBatch(["java", "Main"], jtestcases, { perTestTimeoutMs: 2000 });
    console.log(`  Case 0 result: "${jres1.results.get(0)?.output}" (Expected: "0 1")`);
    console.log(`  Case 1 result: "${jres1.results.get(1)?.output}" (Expected: "1 2")`);
    if (jres1.results.get(0)?.output !== "0 1" || jres1.results.get(1)?.output !== "1 2") {
      throw new Error("Java protocol was corrupted by System.out.println!");
    }
    console.log("  ✓ Java protocol protected against System.out.println injection!");

    // Test 2: Fatal JVM Error Handling (StackOverflowError)
    console.log("\n[Java Audit 2] Fatal JVM Error Handling (StackOverflowError)");
    const fatalJavaCode = `
static void recurse() { recurse(); }
public static int[] twoSum(int[] nums, int target) {
    if (target == 999) recurse();
    return new int[] { 0, 1 };
}
`;
    fs.writeFileSync(path.join(javaJobDir, "MainFatal.java"), javaTemplate.replace("public class Main {", "public class MainFatal {").replace("/***USER_CODE***/", fatalJavaCode));
    await javaSandbox.exec(["javac", "MainFatal.java"], { timeoutMs: 15000 });
    const fatalCases = [
      { id: 0, input: "3 1 2 3 3", output: "0 1" },
      { id: 1, input: "3 1 2 3 999", output: "0 1" }, // StackOverflowError
    ];
    const fatalRes = await javaSandbox.runInteractiveBatch(["java", "MainFatal"], fatalCases, { perTestTimeoutMs: 2000 });
    console.log(`  Case 1 status: ${fatalRes.results.get(1)?.status} | Error: ${fatalRes.results.get(1)?.error}`);
    if (fatalRes.results.get(1)?.status !== "FATAL_ERROR") throw new Error("Expected FATAL_ERROR for StackOverflowError");
    console.log("  ✓ Fatal JVM Error cleanly trapped and JVM terminated!");

    // Test 3: True Per-Test-Case Timeout & Orphan Process Cleanup
    console.log("\n[Java Audit 3] Java Infinite Loop Watchdog & Process Termination");
    const jLoopCode = `
public static int[] twoSum(int[] nums, int target) {
    if (target == 999) while(true) {}
    return new int[] { 0, 1 };
}
`;
    fs.writeFileSync(path.join(javaJobDir, "MainLoop.java"), javaTemplate.replace("public class Main {", "public class MainLoop {").replace("/***USER_CODE***/", jLoopCode));
    await javaSandbox.exec(["javac", "MainLoop.java"], { timeoutMs: 15000 });
    const jLoopCases = [
      { id: 0, input: "3 1 2 3 3", output: "0 1" },
      { id: 1, input: "3 1 2 3 999", output: "0 1" },
    ];
    const jLoopRes = await javaSandbox.runInteractiveBatch(["java", "MainLoop"], jLoopCases, { perTestTimeoutMs: 1500 });
    console.log(`  timedOutTestCaseId = ${jLoopRes.timedOutTestCaseId} (Expected: 1)`);
    if (jLoopRes.timedOutTestCaseId !== 1) throw new Error("Expected Java testcase 1 to time out");

    const jProcs = getContainerProcesses(javaSandbox.containerName);
    console.log(`  Active processes in container after Java timeout: [${jProcs.join(", ")}]`);
    if (jProcs.some((p) => p.includes("java"))) {
      throw new Error("Orphan Java process survived after timeout!");
    }
    console.log("  ✓ Orphan Java process killed forcefully; container is clean!");

    // Test 4: Java Benchmark (1, 10, 100, 1,000 cases)
    console.log("\n[Java Benchmark] Interactive Streaming Benchmark");
    for (const count of [1, 10, 100, 1000]) {
      const benchmarkCases = Array.from({ length: count }, (_, i) => ({
        id: i,
        input: `3 1 2 3 3`,
        output: "0 1",
      }));
      const t0 = performance.now();
      const benchRes = await javaSandbox.runInteractiveBatch(["java", "Main"], benchmarkCases, { perTestTimeoutMs: 2000 });
      const elapsed = performance.now() - t0;
      console.log(`  Java ${count} cases: ${benchRes.results.size}/${count} validated in ${Math.round(elapsed)}ms (${(elapsed / count).toFixed(2)}ms / testcase)`);
      if (benchRes.results.size !== count) throw new Error(`Benchmark failed for ${count} Java cases`);
    }

  } finally {
    await javaSandbox.destroy();
    cleanupSandbox(javaJobDir);
    console.log("✓ Java Sandbox cleaned up.\n");
  }

  console.log("=======================================================================");
  console.log("ALL HARDENED AUDIT CHECKS & BENCHMARKS PASSED 100%!");
  console.log("=======================================================================\n");
}

runHardenedTests().catch((err) => {
  console.error("Hardened audit test failed:", err);
  process.exit(1);
});
