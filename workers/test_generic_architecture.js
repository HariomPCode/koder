const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const { Question, Submission } = require("@koder/shared");
const User = mongoose.models.User || mongoose.model("User", new mongoose.Schema({
  firstName: String,
  lastName: String,
  email: String,
  password: String,
  role: { type: String, default: "user" }
}));
const jsExecutor = require("./javascript/executor");
const javaExecutor = require("./java/executor");


async function runGenericArchitectureTests() {
  console.log("=======================================================================");
  console.log("STARTING GENERIC PROBLEM ARCHITECTURE END-TO-END VERIFICATION");
  console.log("=======================================================================\n");

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✓ Connected to MongoDB");

  // Fetch or create a test user
  let user = await User.findOne({ email: "test@judge.com" });
  if (!user) {
    user = await User.create({
      firstName: "Test",
      lastName: "Judge",
      email: "test@judge.com",
      password: "hashedpassword123",
    });
  }

  // Load all questions from DB
  const questions = await Question.find({}).sort({ questionNum: 1 });
  console.log(`Loaded ${questions.length} questions from database.\n`);

  const qMap = {};
  for (const q of questions) {
    qMap[q.slug] = q;
  }

  let testsPassed = 0;
  let testsTotal = 0;

  async function testSubmission({ slug, language, code, expectedVerdict, testName }) {
    testsTotal++;
    const question = qMap[slug];
    if (!question) {
      throw new Error(`Question not found: ${slug}`);
    }

    const submission = await Submission.create({
      userId: user._id,
      questionId: question._id,
      code,
      language,
      status: "pending",
    });

    const job = {
      id: `test-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      data: {
        submissionId: submission._id,
      },
    };

    let result;
    if (language === "javascript") {
      result = await jsExecutor(job);
    } else if (language === "java") {
      result = await javaExecutor(job);
    } else {
      throw new Error(`Unsupported test language: ${language}`);
    }

    const isMatch = result.verdict === expectedVerdict;
    if (isMatch) {
      testsPassed++;
      console.log(`  ✓ [${language.toUpperCase()}] ${testName}: ${result.verdict} (Passed ${result.passedTestCases}/${result.totalTestCases}, Runtime: ${result.maxRuntime}ms)`);
    } else {
      console.error(`  ✗ [${language.toUpperCase()}] ${testName} FAILED: Expected "${expectedVerdict}", got "${result.verdict}"`);
      if (result.errorMessage) console.error(`    Error: ${result.errorMessage}`);
      if (result.failedTestCase) console.error(`    Failed TC: `, result.failedTestCase);
      throw new Error(`Assertion failed for ${testName}`);
    }

    return result;
  }

  // =========================================================================
  // 1. JAVASCRIPT END-TO-END TEST SUITE
  // =========================================================================
  console.log("-----------------------------------------------------------------------");
  console.log("TEST SUITE 1: JAVASCRIPT GENERIC EXECUTION");
  console.log("-----------------------------------------------------------------------");

  // 1. Two Sum (Arrays / Multiple Params) - AC
  await testSubmission({
    slug: "two-sum",
    language: "javascript",
    code: `function twoSum(nums, target) {
      const map = new Map();
      for (let i = 0; i < nums.length; i++) {
        const comp = target - nums[i];
        if (map.has(comp)) return [map.get(comp), i];
        map.set(nums[i], i);
      }
      return [];
    }`,
    expectedVerdict: "Accepted",
    testName: "Two Sum -> Accepted",
  });

  // 2. Two Sum - Wrong Answer
  await testSubmission({
    slug: "two-sum",
    language: "javascript",
    code: `function twoSum(nums, target) {
      return [0, 0];
    }`,
    expectedVerdict: "Wrong Answer",
    testName: "Two Sum -> Wrong Answer",
  });

  // 3. Two Sum - Runtime Error
  await testSubmission({
    slug: "two-sum",
    language: "javascript",
    code: `function twoSum(nums, target) {
      throw new Error("Deliberate JS exception");
    }`,
    expectedVerdict: "Runtime Error",
    testName: "Two Sum -> Runtime Error",
  });

  // 4. Two Sum - Time Limit Exceeded (Infinite Loop)
  await testSubmission({
    slug: "two-sum",
    language: "javascript",
    code: `function twoSum(nums, target) {
      while (true) {}
    }`,
    expectedVerdict: "Time Limit Exceeded",
    testName: "Two Sum -> Time Limit Exceeded (Infinite Loop)",
  });

  // 5. Valid Palindrome (String -> Boolean) - AC
  await testSubmission({
    slug: "valid-palindrome",
    language: "javascript",
    code: `function isPalindrome(s) {
      let l = 0, r = s.length - 1;
      while (l < r) {
        if (s[l] !== s[r]) return false;
        l++;
        r--;
      }
      return true;
    }`,
    expectedVerdict: "Accepted",
    testName: "Valid Palindrome -> Accepted",
  });

  // 6. Valid Palindrome - WA
  await testSubmission({
    slug: "valid-palindrome",
    language: "javascript",
    code: `function isPalindrome(s) {
      return true; // Fails on "hello", "ab"
    }`,
    expectedVerdict: "Wrong Answer",
    testName: "Valid Palindrome -> Wrong Answer",
  });

  // 7. Find Maximum Element (int[] -> int) - AC
  await testSubmission({
    slug: "find-maximum-in-array",
    language: "javascript",
    code: `function findMax(nums) {
      let mx = nums[0];
      for (let i = 1; i < nums.length; i++) {
        if (nums[i] > mx) mx = nums[i];
      }
      return mx;
    }`,
    expectedVerdict: "Accepted",
    testName: "Find Maximum Element -> Accepted",
  });

  // 8. Running Sum of 1D Array (int[] -> int[]) - AC
  await testSubmission({
    slug: "running-sum-of-1d-array",
    language: "javascript",
    code: `function runningSum(nums) {
      const res = new Array(nums.length);
      res[0] = nums[0];
      for (let i = 1; i < nums.length; i++) {
        res[i] = res[i - 1] + nums[i];
      }
      return res;
    }`,
    expectedVerdict: "Accepted",
    testName: "Running Sum of 1D Array -> Accepted",
  });

  // 9. Binary Search (int[], int -> int) - AC
  await testSubmission({
    slug: "binary-search",
    language: "javascript",
    code: `function search(nums, target) {
      let l = 0, r = nums.length - 1;
      while (l <= r) {
        const mid = Math.floor((l + r) / 2);
        if (nums[mid] === target) return mid;
        if (nums[mid] < target) l = mid + 1;
        else r = mid - 1;
      }
      return -1;
    }`,
    expectedVerdict: "Accepted",
    testName: "Binary Search -> Accepted",
  });

  // 10. Valid Anagram (string, string -> boolean) - AC
  await testSubmission({
    slug: "valid-anagram",
    language: "javascript",
    code: `function isAnagram(s, t) {
      if (s.length !== t.length) return false;
      const count = {};
      for (const ch of s) count[ch] = (count[ch] || 0) + 1;
      for (const ch of t) {
        if (!count[ch]) return false;
        count[ch]--;
      }
      return true;
    }`,
    expectedVerdict: "Accepted",
    testName: "Valid Anagram -> Accepted",
  });

  // 11. Reverse String (string -> string) - AC
  await testSubmission({
    slug: "reverse-string",
    language: "javascript",
    code: `function reverseString(s) {
      return s.split('').reverse().join('');
    }`,
    expectedVerdict: "Accepted",
    testName: "Reverse String -> Accepted",
  });

  // 12. Fibonacci Number (int -> int) - AC
  await testSubmission({
    slug: "fibonacci-number",
    language: "javascript",
    code: `function fib(n) {
      if (n <= 1) return n;
      let a = 0, b = 1;
      for (let i = 2; i <= n; i++) {
        const c = a + b;
        a = b;
        b = c;
      }
      return b;
    }`,
    expectedVerdict: "Accepted",
    testName: "Fibonacci Number -> Accepted",
  });

  // =========================================================================
  // 2. JAVA END-TO-END TEST SUITE
  // =========================================================================
  console.log("\n-------------------------------------------");
  console.log("TEST SUITE 2: JAVA GENERIC EXECUTION");
  console.log("-------------------------------------------");

  // 13. Java Two Sum (Standard LeetCode Solution Class) - AC
  await testSubmission({
    slug: "two-sum",
    language: "java",
    code: `class Solution {
    public int[] twoSum(int[] nums, int target) {
        Map<Integer, Integer> map = new HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            int comp = target - nums[i];
            if (map.containsKey(comp)) return new int[] { map.get(comp), i };
            map.put(nums[i], i);
        }
        return new int[] {};
    }
}`,
    expectedVerdict: "Accepted",
    testName: "Java Two Sum (class Solution) -> Accepted",
  });

  // 14. Java Two Sum (Raw Method without class wrapper) - AC
  await testSubmission({
    slug: "two-sum",
    language: "java",
    code: `public int[] twoSum(int[] nums, int target) {
        Map<Integer, Integer> map = new HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            int comp = target - nums[i];
            if (map.containsKey(comp)) return new int[] { map.get(comp), i };
            map.put(nums[i], i);
        }
        return new int[] {};
    }`,
    expectedVerdict: "Accepted",
    testName: "Java Two Sum (Raw method) -> Accepted",
  });

  // 15. Java Two Sum (Static Method) - AC
  await testSubmission({
    slug: "two-sum",
    language: "java",
    code: `public static int[] twoSum(int[] nums, int target) {
        Map<Integer, Integer> map = new HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            int comp = target - nums[i];
            if (map.containsKey(comp)) return new int[] { map.get(comp), i };
            map.put(nums[i], i);
        }
        return new int[] {};
    }`,
    expectedVerdict: "Accepted",
    testName: "Java Two Sum (Static method) -> Accepted",
  });

  // 16. Java Two Sum - Wrong Answer
  await testSubmission({
    slug: "two-sum",
    language: "java",
    code: `class Solution {
    public int[] twoSum(int[] nums, int target) {
        return new int[] { 0, 0 };
    }
}`,
    expectedVerdict: "Wrong Answer",
    testName: "Java Two Sum -> Wrong Answer",
  });

  // 17. Java Compilation Error
  await testSubmission({
    slug: "two-sum",
    language: "java",
    code: `class Solution {
    public int[] twoSum(int[] nums, int target) {
        this is not valid java syntax;
    }
}`,
    expectedVerdict: "Compilation Error",
    testName: "Java Compilation Error",
  });

  // 18. Java Runtime Exception (NullPointerException)
  await testSubmission({
    slug: "two-sum",
    language: "java",
    code: `class Solution {
    public int[] twoSum(int[] nums, int target) {
        String s = null;
        s.length(); // NPE
        return new int[] { 0, 1 };
    }
}`,
    expectedVerdict: "Runtime Error",
    testName: "Java Runtime Error (NPE)",
  });

  // 19. Java Time Limit Exceeded (Infinite Loop)
  await testSubmission({
    slug: "two-sum",
    language: "java",
    code: `class Solution {
    public int[] twoSum(int[] nums, int target) {
        while (true) {}
    }
}`,
    expectedVerdict: "Time Limit Exceeded",
    testName: "Java Time Limit Exceeded (Infinite Loop)",
  });

  // 20. Java Valid Palindrome (String -> boolean) - AC
  await testSubmission({
    slug: "valid-palindrome",
    language: "java",
    code: `class Solution {
    public boolean isPalindrome(String s) {
        int l = 0, r = s.length() - 1;
        while (l < r) {
            if (s.charAt(l) != s.charAt(r)) return false;
            l++;
            r--;
        }
        return true;
    }
}`,
    expectedVerdict: "Accepted",
    testName: "Java Valid Palindrome -> Accepted",
  });

  // 21. Java Find Maximum Element (int[] -> int) - AC
  await testSubmission({
    slug: "find-maximum-in-array",
    language: "java",
    code: `class Solution {
    public int findMax(int[] nums) {
        int mx = nums[0];
        for (int i = 1; i < nums.length; i++) {
            if (nums[i] > mx) mx = nums[i];
        }
        return mx;
    }
}`,
    expectedVerdict: "Accepted",
    testName: "Java Find Maximum Element -> Accepted",
  });

  // 22. Java Running Sum of 1D Array (int[] -> int[]) - AC
  await testSubmission({
    slug: "running-sum-of-1d-array",
    language: "java",
    code: `class Solution {
    public int[] runningSum(int[] nums) {
        int[] res = new int[nums.length];
        res[0] = nums[0];
        for (int i = 1; i < nums.length; i++) {
            res[i] = res[i - 1] + nums[i];
        }
        return res;
    }
}`,
    expectedVerdict: "Accepted",
    testName: "Java Running Sum -> Accepted",
  });

  // 23. Java Binary Search (int[], int -> int) - AC
  await testSubmission({
    slug: "binary-search",
    language: "java",
    code: `class Solution {
    public int search(int[] nums, int target) {
        int l = 0, r = nums.length - 1;
        while (l <= r) {
            int mid = l + (r - l) / 2;
            if (nums[mid] == target) return mid;
            if (nums[mid] < target) l = mid + 1;
            else r = mid - 1;
        }
        return -1;
    }
}`,
    expectedVerdict: "Accepted",
    testName: "Java Binary Search -> Accepted",
  });

  // 24. Java Valid Anagram (String, String -> boolean) - AC
  await testSubmission({
    slug: "valid-anagram",
    language: "java",
    code: `class Solution {
    public boolean isAnagram(String s, String t) {
        if (s.length() != t.length()) return false;
        int[] count = new int[256];
        for (int i = 0; i < s.length(); i++) {
            count[s.charAt(i)]++;
            count[t.charAt(i)]--;
        }
        for (int c : count) {
            if (c != 0) return false;
        }
        return true;
    }
}`,
    expectedVerdict: "Accepted",
    testName: "Java Valid Anagram -> Accepted",
  });

  // 25. Java Reverse String (String -> String) - AC
  await testSubmission({
    slug: "reverse-string",
    language: "java",
    code: `class Solution {
    public String reverseString(String s) {
        return new StringBuilder(s).reverse().toString();
    }
}`,
    expectedVerdict: "Accepted",
    testName: "Java Reverse String -> Accepted",
  });

  // 26. Java Fibonacci Number (int -> int) - AC
  await testSubmission({
    slug: "fibonacci-number",
    language: "java",
    code: `class Solution {
    public int fib(int n) {
        if (n <= 1) return n;
        int a = 0, b = 1;
        for (int i = 2; i <= n; i++) {
            int c = a + b;
            a = b;
            b = c;
        }
        return b;
    }
}`,
    expectedVerdict: "Accepted",
    testName: "Java Fibonacci Number -> Accepted",
  });

  console.log("\n=======================================================================");
  console.log(`ALL ${testsPassed}/${testsTotal} END-TO-END VERIFICATION TESTS PASSED SUCCESSFULLY!`);
  console.log("=======================================================================\n");

  await mongoose.disconnect();
}

runGenericArchitectureTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
