const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");

const apiRoute = require("./routes/apiRoute");
const adminRoute = require("./routes/admin.route");
const { notFoundHandler, errorHandler } = require("./errorHandler");

function createApp() {
  const app = express();

  app.use(
    cors({
      origin: "http://localhost:3000",
      credentials: true,
    }),
  );

  app.use(express.json());
  app.use(cookieParser());

  app.use("/api/v1", apiRoute);
  app.use("/admin", adminRoute);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
