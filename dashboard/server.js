const express = require("express");
const path = require("path");
const apiRoutes = require("./api");

const app = express();
app.use(express.json());

app.use("/api", apiRoutes);
app.use(express.static(path.join(__dirname, "public")));

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
});
