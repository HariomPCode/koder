const assert = require("assert");
const bcrypt = require("bcrypt");
const cookieParser = require("cookie-parser");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "test-secret-key-12345";
process.env.NODE_ENV = "test";

const User = require("./models/User");
const authRoute = require("./routes/auth.route");
const userRoute = require("./routes/user.route");

async function runTests() {
  const passwordHash = await bcrypt.hash("password123", 4);
  const user = new User({
    _id: "60c72b2f9b1d8b0015f8e001",
    firstName: "Test",
    lastName: "User",
    email: "user@test.com",
    password: passwordHash,
    role: "user",
  });

  User.findOne = async (query) =>
    query.email === user.email ? user : null;
  User.findById = () => ({
    select: async () => user.toJSON(),
  });

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/v1/auth", authRoute);
  app.use("/api/v1/user", userRoute);

  const server = app.listen(0);
  server.unref();
  const baseUrl = `http://localhost:${server.address().port}`;

  try {
    const signinResponse = await fetch(`${baseUrl}/api/v1/auth/signin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: user.email,
        password: "password123",
      }),
    });

    assert.strictEqual(signinResponse.status, 200);
    const signinBody = await signinResponse.json();
    assert.ok(!JSON.stringify(signinBody).includes("eyJ"), "Signin must not expose the JWT");

    const issuedCookie = signinResponse.headers.get("set-cookie");
    assert.ok(issuedCookie, "Signin must issue an auth cookie");
    assert.match(issuedCookie, /^auth_token=[^;]+;/);
    assert.match(issuedCookie, /Path=\//);
    assert.match(issuedCookie, /HttpOnly/);
    assert.match(issuedCookie, /SameSite=Lax/);

    const authCookie = issuedCookie.split(";", 1)[0];
    const authenticatedResponse = await fetch(`${baseUrl}/api/v1/user`, {
      headers: { Cookie: authCookie },
    });
    assert.strictEqual(authenticatedResponse.status, 200);

    const signoutResponse = await fetch(`${baseUrl}/api/v1/auth/signout`, {
      method: "POST",
      headers: { Cookie: authCookie },
    });
    assert.strictEqual(signoutResponse.status, 200);
    const signoutBody = await signoutResponse.json();
    assert.ok(!JSON.stringify(signoutBody).includes("eyJ"), "Signout must not expose the JWT");

    const clearedCookie = signoutResponse.headers.get("set-cookie");
    assert.ok(clearedCookie, "Signout must issue a clearing cookie");
    assert.match(clearedCookie, /^auth_token=;/);
    assert.match(clearedCookie, /Path=\//);
    assert.match(clearedCookie, /Expires=Thu, 01 Jan 1970/);
    assert.match(clearedCookie, /HttpOnly/);
    assert.match(clearedCookie, /SameSite=Lax/);

    const unauthenticatedResponse = await fetch(`${baseUrl}/api/v1/user`);
    assert.strictEqual(unauthenticatedResponse.status, 401);

    const statelessTokenResponse = await fetch(`${baseUrl}/api/v1/user`, {
      headers: { Cookie: authCookie },
    });
    assert.strictEqual(
      statelessTokenResponse.status,
      200,
      "A stateless JWT remains valid if a client deliberately reuses its token",
    );

    console.log("✓ Logout clears the browser cookie and prevents subsequent cookie-less authentication");
    console.log("✓ Confirmed limitation: logout does not revoke a stateless JWT server-side");
  } finally {
    server.closeAllConnections?.();
    server.closeIdleConnections?.();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

runTests().catch((error) => {
  console.error("Logout regression test failed:", error);
  process.exit(1);
});
