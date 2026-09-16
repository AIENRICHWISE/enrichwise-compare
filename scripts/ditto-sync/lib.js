// Shared config for the Ditto → Kavach catalog sync scripts.
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "out");
const KAVACH_API = "https://tools.enrichwise.co.in/kavach/api/insurance-compare";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) EnrichwiseCatalogSync/1.0";

// Catalog insurer key -> Ditto provider slug (joinditto.in/health-insurance/<slug>/).
// Kotak is absent: Ditto does not list it.
const PROVIDERS = {
  acko: "acko", adityabirla: "aditya-birla", bajaj: "bajaj-general", care: "care", hdfc: "hdfc-ergo",
  icici: "icici-lombard", iffcotokio: "iffco-tokio", manipalcigna: "manipal-cigna", national: "national-insurance",
  newindia: "new-india-assurance", niva: "niva-bupa", oriental: "oriental-insurance", reliance: "reliance",
  star: "star-health", tata: "tata-aig", universalsompo: "universal-sompo",
};

// Approval writes `newValue` as a plain STRING into InsurancePlan.data[field]
// (kavach settings/insurance-compare/actions.ts). Only these fields are strings
// in the tool. Never propose restore, ncbModel, uniqueFeatures, sumInsured,
// addOns or instantCover — the chart and scoring read those as objects.
const SAFE_FIELDS = new Set(["claimSettlementRatio", "networkHospitals", "roomRent", "coPay", "prePost", "dayCare", "ayush"]);

const LABELS = {
  claimSettlementRatio: "Claim settlement ratio", networkHospitals: "Network hospitals", roomRent: "Room rent",
  coPay: "Co-pay", prePost: "Pre / Post hospitalization", dayCare: "Day care", ayush: "AYUSH",
};

const outPath = (name) => path.join(OUT, name);
function readOut(name) {
  const p = outPath(name);
  if (!fs.existsSync(p)) throw new Error(`missing ${path.relative(process.cwd(), p)} — run the earlier step first (see README)`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function writeOut(name, data) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(outPath(name), JSON.stringify(data, null, 1));
  return outPath(name);
}
const readMatches = () => JSON.parse(fs.readFileSync(path.join(__dirname, "matches.json"), "utf8"));

module.exports = { OUT, KAVACH_API, UA, PROVIDERS, SAFE_FIELDS, LABELS, outPath, readOut, writeOut, readMatches };
