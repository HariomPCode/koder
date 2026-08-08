const fs = require("fs");
const input = fs.readFileSync(0, "utf8").trim().split("\n");
const n = +input[0];
const nums = input[1].split(" ").map(Number);
const target = +input[2];

/***USER_CODE***/

const ans = twoSum(nums, target);

console.log(ans.join(" "));
