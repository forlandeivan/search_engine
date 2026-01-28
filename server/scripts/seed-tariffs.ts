import "../load-env";
import { seedDefaultTariffs } from "../tariff-seed";

seedDefaultTariffs()
  .then(() => {
    console.log("[tariff-seed] completed");
    process.exit(0);
  })
  .catch((err) => {
    console.error("[tariff-seed] failed", err);
    process.exit(1);
  });
