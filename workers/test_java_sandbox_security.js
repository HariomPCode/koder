const assert = require("assert");
const { createExecutionExecutor } = require("./common/executionEngine");
const javaExecutor = require("./java/executor");

async function judge(details, id) {
  const updates = [];
  const execute = createExecutionExecutor(javaExecutor.config, {
    getQuestionDetails: async () => details,
    updateSubmission: async (_submissionId, result) => {
      updates.push(result);
      return result;
    },
  });
  await execute({ id, data: { submissionId: id } });
  return updates[0];
}

const twoSumMeta = {
  language: "java",
  slug: "two-sum",
  functionName: "twoSum",
  parameters: [
    { name: "nums", type: "int[]" },
    { name: "target", type: "int" },
  ],
  returnType: "int[]",
};

async function run() {
  const probesOnly = process.env.KODER_SECURITY_PROBES_ONLY === "1";
  const normalCases = [
    {
      ...twoSumMeta,
      code: `public int[] twoSum(int[] nums, int target) {
        System.out.println("debug output is isolated from the judge protocol");
        HashMap<Integer, Integer> seen = new HashMap<>();
        for (int i = 0; i < nums.length; i++) {
          int needed = target - nums[i];
          if (seen.containsKey(needed)) return new int[] { seen.get(needed), i };
          seen.put(nums[i], i);
        }
        return new int[] {};
      }`,
      testcases: [{ input: "4 2 7 11 15 9", output: "0 1" }],
    },
    {
      language: "java", slug: "valid-palindrome", functionName: "isPalindrome",
      parameters: [{ name: "s", type: "String" }], returnType: "boolean",
      code: `public boolean isPalindrome(String s) {
        return new StringBuilder(s).reverse().toString().equals(s);
      }`,
      testcases: [{ input: "racecar", output: "true" }],
    },
    {
      language: "java", slug: "find-maximum-element", functionName: "findMax",
      parameters: [{ name: "nums", type: "int[]" }], returnType: "int",
      code: `public int findMax(int[] nums) {
        int max = Integer.MIN_VALUE;
        for (int value : nums) max = Math.max(max, value);
        return max;
      }`,
      testcases: [{ input: "4 -2 9 3 1", output: "9" }],
    },
    {
      language: "java", slug: "binary-search", functionName: "search",
      parameters: [{ name: "nums", type: "int[]" }, { name: "target", type: "int" }],
      returnType: "int",
      code: `public int search(int[] nums, int target) {
        int left = 0, right = nums.length - 1;
        while (left <= right) {
          int mid = left + (right - left) / 2;
          if (nums[mid] == target) return mid;
          if (nums[mid] < target) left = mid + 1; else right = mid - 1;
        }
        return -1;
      }`,
      testcases: [{ input: "5 1 3 5 7 9 7", output: "3" }],
    },
  ];

  if (!probesOnly) {
    for (let index = 0; index < normalCases.length; index++) {
      const result = await judge(normalCases[index], `java-normal-${index}`);
      assert.strictEqual(result.verdict, "Accepted");
    }
  }

  const securityProbe = {
    language: "java", slug: "java-security", functionName: "audit",
    parameters: [{ name: "mode", type: "int" }], returnType: "String",
    code: `public String audit(int mode) {
      try {
        if (mode == 1) Runtime.getRuntime().exec("echo forbidden");
        if (mode == 2) System.getenv("JWT_SECRET");
        if (mode == 3) java.nio.file.Files.readString(java.nio.file.Path.of("/etc/passwd"));
        if (mode == 4) new java.net.Socket("1.1.1.1", 53);
        return "allowed";
      } catch (SecurityException expected) {
        return "blocked";
      } catch (Exception unexpected) {
        return "blocked";
      }
    }`,
    testcases: [1, 2, 3, 4].map((mode) => ({ input: String(mode), output: "blocked" })),
  };
  const securityResult = await judge(securityProbe, "java-security-probes");
  assert.strictEqual(
    securityResult.verdict,
    "Accepted",
    securityResult.errorMessage || "security probe did not return Accepted",
  );
  if (probesOnly) return;

  const wrongAnswer = await judge({
    ...twoSumMeta,
    code: "public int[] twoSum(int[] nums, int target) { return new int[] { 0, 0 }; }",
    testcases: [{ input: "4 2 7 11 15 9", output: "0 1" }],
  }, "java-wrong-answer");
  assert.strictEqual(wrongAnswer.verdict, "Wrong Answer");

  const compilationError = await judge({
    ...twoSumMeta,
    code: "public int[] twoSum(int[] nums, int target) { return new int[] { ; }",
    testcases: [{ input: "4 2 7 11 15 9", output: "0 1" }],
  }, "java-compilation-error");
  assert.strictEqual(compilationError.verdict, "Compilation Error");

  const runtimeError = await judge({
    ...twoSumMeta,
    code: "public int[] twoSum(int[] nums, int target) { throw new IllegalStateException(\"boom\"); }",
    testcases: [{ input: "4 2 7 11 15 9", output: "0 1" }],
  }, "java-runtime-error");
  assert.strictEqual(runtimeError.verdict, "Runtime Error");

  const timeout = await judge({
    ...twoSumMeta,
    code: "public int[] twoSum(int[] nums, int target) { while (true) {} }",
    testcases: [{ input: "4 2 7 11 15 9", output: "0 1" }],
  }, "java-timeout");
  assert.strictEqual(timeout.verdict, "Time Limit Exceeded");

  const memoryFailure = await judge({
    ...twoSumMeta,
    code: "public int[] twoSum(int[] nums, int target) { int[] x = new int[200_000_000]; return x; }",
    testcases: [{ input: "4 2 7 11 15 9", output: "0 1" }],
  }, "java-memory");
  assert.ok(["Runtime Error", "Time Limit Exceeded"].includes(memoryFailure.verdict));

  console.log("✓ Java function runner, resource controls, and security API guards verified in Docker");
}

run().catch((error) => {
  console.error("Java sandbox security test failed:", error);
  process.exit(1);
});
