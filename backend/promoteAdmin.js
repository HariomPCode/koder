const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const User = require("./models/User");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function promoteAdmin() {
  const rawEmail = process.argv[2];

  if (!rawEmail || typeof rawEmail !== "string" || !rawEmail.trim()) {
    console.error("Error: Missing email argument.");
    console.error("Usage: node promoteAdmin.js <user-email>");
    process.exit(1);
  }

  const normalizedEmail = rawEmail.trim().toLowerCase();

  if (!EMAIL_REGEX.test(normalizedEmail)) {
    console.error(`Error: "${rawEmail}" is not a valid email address.`);
    process.exit(1);
  }

  if (!process.env.MONGODB_URI) {
    console.error("Error: MONGODB_URI is not defined in environment variables.");
    process.exit(1);
  }

  let exitCode = 0;

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB.");

    const user = await User.findOneAndUpdate(
      { email: normalizedEmail },
      { $set: { role: "admin" } },
      { new: true },
    );

    if (!user) {
      console.error(`Error: User with email "${normalizedEmail}" not found.`);
      exitCode = 1;
    } else {
      console.log(`✓ Successfully promoted ${user.firstName} ${user.lastName} (${user.email}) to role: "admin".`);
    }
  } catch (error) {
    console.error("Error: Failed to promote user:", error.message);
    exitCode = 1;
  } finally {
    try {
      await mongoose.disconnect();
      console.log("Disconnected from MongoDB.");
    } catch (disconnectErr) {
      console.error("Error disconnecting from MongoDB:", disconnectErr.message);
    }
    process.exit(exitCode);
  }
}

promoteAdmin();
