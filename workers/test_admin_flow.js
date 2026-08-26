const path = require("path");
const mongoose = require("../backend/node_modules/mongoose");
require("../backend/node_modules/dotenv").config({ path: path.resolve(__dirname, "../backend/.env") });

const Question = require("../backend/models/Question");
const Submission = require("../backend/models/Submission");
const User = require("../backend/models/User");
const { generateStarterCode } = require("./common/templateGenerator");
const jsExecutor = require("./javascript/executor");
const javaExecutor = require("./java/executor");

async function testAdminFlow() {
  console.log("=======================================================================");
  console.log("TESTING ADMIN PROBLEM CREATION & VERIFICATION FLOW");
  console.log("=======================================================================\n");

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✓ Connected to MongoDB");

  const adminProblemData = {
    title: "Contains Duplicate",
    slug: "contains-duplicate",
    difficulty: "Easy",
    description: "Given an integer array nums, return true if any value appears at least twice in the array, and return false if every element is distinct.",
    functionName: "containsDuplicate",
    parameters: [
      { name: "nums", type: "int[]" }
    ],
    returnType: "boolean",
    constraints: [
      "1 <= nums.length <= 10^5",
      "-10^9 <= nums[i] <= 10^9"
    ],
    sampleTestCases: [
      { input: "4\n1 2 3 1", output: "true" },
      { input: "4\n1 2 3 4", output: "false" }
    ],
    hiddenTestCases: [
      { input: "10\n1 1 1 3 3 4 3 2 4 2", output: "true" },
      { input: "1\n100", output: "false" }
    ],
    tags: ["Array", "Hash Table"]
  };

  // 1. Simulate Admin Problem Creation
  console.log("\n[Step 1] Admin creates problem 'Contains Duplicate'...");
  const starterCode = generateStarterCode({
    functionName: adminProblemData.functionName,
    parameters: adminProblemData.parameters,
    returnType: adminProblemData.returnType,
  });

  const lastQ = await Question.findOne().sort({ questionNum: -1 });
  const questionNum = lastQ ? lastQ.questionNum + 1 : 1;

  const createdQuestion = await Question.findOneAndUpdate(
    { slug: adminProblemData.slug },
    {
      $set: {
        ...adminProblemData,
        questionNum,
        starterCode,
      }
    },
    { upsert: true, new: true }
  );

  console.log("  ✓ Admin created question #" + createdQuestion.questionNum + ": " + createdQuestion.title);
  console.log("  ✓ Auto-generated " + createdQuestion.starterCode.length + " starter code templates (JS, Java, Python)");

  // 2. Simulate User Submitting JavaScript Solution
  console.log("\n[Step 2] User submits JavaScript solution for Contains Duplicate...");
  const user = await User.findOne({ email: "test@judge.com" });
  
  const jsSubmission = await Submission.create({
    userId: user._id,
    questionId: createdQuestion._id,
    language: "javascript",
    code: "function containsDuplicate(nums) {\n  const set = new Set();\n  for (const num of nums) {\n    if (set.has(num)) return true;\n    set.add(num);\n  }\n  return false;\n}",
    status: "pending",
  });

  const jsResult = await jsExecutor({
    id: "admin-test-js-" + Date.now(),
    data: { submissionId: jsSubmission._id },
  });

  console.log("  ✓ JS Submission Verdict: " + jsResult.verdict + " (" + jsResult.passedTestCases + "/" + jsResult.totalTestCases + " test cases passed)");
  if (jsResult.verdict !== "Accepted") throw new Error("Expected JS solution to be Accepted");

  // 3. Simulate User Submitting Java Solution
  console.log("\n[Step 3] User submits Java solution for Contains Duplicate...");
  const javaSubmission = await Submission.create({
    userId: user._id,
    questionId: createdQuestion._id,
    language: "java",
    code: "class Solution {\n    public boolean containsDuplicate(int[] nums) {\n        Set<Integer> set = new HashSet<>();\n        for (int num : nums) {\n            if (set.contains(num)) return true;\n            set.add(num);\n        }\n        return false;\n    }\n}",
    status: "pending",
  });

  const javaResult = await javaExecutor({
    id: "admin-test-java-" + Date.now(),
    data: { submissionId: javaSubmission._id },
  });

  console.log("  ✓ Java Submission Verdict: " + javaResult.verdict + " (" + javaResult.passedTestCases + "/" + javaResult.totalTestCases + " test cases passed)");
  if (javaResult.verdict !== "Accepted") throw new Error("Expected Java solution to be Accepted");

  console.log("\n=======================================================================");
  console.log("ADMIN PROBLEM CREATION & EXECUTION FLOW VERIFIED 100%!");
  console.log("=======================================================================\n");

  await mongoose.disconnect();
}

testAdminFlow().catch((err) => {
  console.error("Admin flow test failed:", err);
  process.exit(1);
});