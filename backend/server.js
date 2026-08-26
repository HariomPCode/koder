const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
require("dotenv").config();

const { queue } = require("./queue");
const connectDB = require("./db");
const apiRoute = require("./routes/apiRoute");
const adminRoute = require("./routes/admin.route");

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

async function startServer() {
  await connectDB();

  app.listen(5000, () => {
    console.log("Server is running on port 5000");
  });
}

startServer();
