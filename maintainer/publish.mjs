// Turn an entry into results/<model>/<instance>/<entry>.json, the file qmbl.org reads.
//
//   node maintainer/publish.mjs <entry folder> <entry.json from op_verify.py combine> [pull request URL]
//
// The result carries what the page shows (system, team, AI label, re-measured energy, compute,
// links) so the site needs no YAML. The page recomputes the gap against the live target on every
// build; gap_at_measurement and new_record_at_measurement record what held on the day.
// Every entry is listed (2026-10-12). One that did not verify carries the problems from
// entry.json as its flags: it takes no record mark and does not count in its system's score.
import fs from "node:fs";
import path from "node:path";
import { parseYaml } from "../scripts/validate.mjs";

const [dir, combined, pr] = process.argv.slice(2);
if (!dir || !combined) {
  console.error("usage: node maintainer/publish.mjs <entry folder> <entry.json> [pull request URL]");
  process.exit(2);
}
const rel = path.relative("submissions", path.resolve(dir)).split(path.sep);
if (rel.length !== 3 || rel[0].startsWith("..")) {
  console.error(`${dir}: not an entry folder submissions/<model>/<instance>/<entry>`);
  process.exit(2);
}
const meta = parseYaml(fs.readFileSync(path.join(dir, "metadata.yaml"), "utf8"));
const v = JSON.parse(fs.readFileSync(combined, "utf8"));
const id = `${rel[0]}/${rel[1]}`;
if (v.instance_id !== id || meta.instance !== id) {
  console.error(`instance mismatch: folder ${id}, metadata ${meta.instance}, measurement ${v.instance_id}`);
  process.exit(2);
}
const flags = v.verified ? [] : v.problems ?? ["did not verify"];
const result = {
  entry: `submissions/${rel.join("/")}`,
  instance_id: id,
  system: meta.system,
  team: meta.team,
  ai_involvement: meta.ai_involvement,
  energy_per_site: v.energy_per_site,
  sigma_per_site: v.sigma_per_site,
  claimed_energy_per_site: meta.energy_per_site,
  measured: new Date().toISOString().slice(0, 10),
  verifier: v.verifier,
  target_at_measurement: v.target,
  gap_at_measurement: v.gap,
  new_record_at_measurement: v.verified ? v.new_record : false,
  verified: Boolean(v.verified),
  flags,
  measurements: v.measurements,
  compute: meta.compute,
  links: { code: meta.state.code_url, checkpoint: meta.state.checkpoint_url, paper: meta.paper ?? null, pr: pr ?? null },
};
const out = path.join("results", rel[0], rel[1], `${rel[2]}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(result, null, 1) + "\n");
console.log(`${out}: ${meta.system} on ${id}, E/site ${v.energy_per_site} +- ${v.sigma_per_site}` +
  (v.gap == null ? "" : `, gap ${(100 * v.gap).toFixed(4)} %`) + (v.verified && v.new_record ? ", NEW RECORD" : "") +
  (flags.length ? `, FLAGGED:\n- ${flags.join("\n- ")}` : ""));
