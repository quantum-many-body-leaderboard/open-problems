// Tests of scripts/validate.mjs on throw-away copies of this repository.
//   node --test scripts/
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml, validate, qmblIds } from "./validate.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = fs.readFileSync(path.join(REPO, "template/metadata.yaml"), "utf8");
const DIR = "submissions/J1J2/square_100_P_0.5/2026-10-08_example-lab_vit";
// QMBL's instance ids as validate() takes them: 16 sites at J2 = 0.5 is solved (it has an
// exact energy), 14x14 at J2 = 0.33 stands for an instance added to QMBL after the launch list.
const QMBL = {
  known: new Set(["J1J2/square_100_P_0.5", "J1J2/square_16_P_0.5", "J1J2/square_196_P_0.33"]),
  open: new Set(["J1J2/square_100_P_0.5", "J1J2/square_196_P_0.33"]),
};
const QMBL_DIR = process.env.QMBL_DIR ?? path.join(REPO, "..", "qmbl");

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "op-validate-"));
  for (const p of ["schema", "targets", "template"]) fs.cpSync(path.join(REPO, p), path.join(root, p), { recursive: true });
  return root;
}
function entry(root, dir = DIR, meta = TEMPLATE, files = { "log.txt": "E/site -0.4975(4)\n" }) {
  fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(path.join(root, dir, "metadata.yaml"), meta);
  fs.writeFileSync(path.join(root, dir, "README.md"), "# Example ViT on J1-J2 10x10\n\nA ViT with 4 layers, trained with SR for 20k steps.\n");
  for (const [k, v] of Object.entries(files)) fs.writeFileSync(path.join(root, dir, k), v);
}
const run = root => { try { return validate(root, QMBL); } finally { fs.rmSync(root, { recursive: true, force: true }); } };

test("the template as an entry passes", () => {
  const root = repo(); entry(root);
  const r = run(root);
  assert.deepEqual(r.errors, []);
  assert.equal(r.entries, 1);
});

test("the YAML subset", () => {
  const y = parseYaml('a: "x # y"  # comment\nb: 1.5e-3\nc:\n  d: null\n  e: true\nf:\ng: \'it\'\'s\'\n');
  assert.deepEqual(y, { a: "x # y", b: 0.0015, c: { d: null, e: true }, f: null, g: "it's" });
  assert.throws(() => parseYaml("a:\n\tb: 1\n"), /tabs/);
  assert.throws(() => parseYaml("a:\n  - 1\n"), /lists/);
  assert.throws(() => parseYaml("a: 1\na: 2\n"), /twice/);
  assert.throws(() => parseYaml("a: [1, 2]\n"), /plain subset/);
});

test("missing log, unknown field, wrong label, wrong instance", () => {
  const root = repo();
  entry(root, DIR, TEMPLATE.replace('ai_involvement: "human+ai"', 'ai_involvement: "mostly ai"').replace("date:", "colour: blue\ndate:"), {});
  const e = run(root).errors.join("\n");
  assert.match(e, /log\.txt or \*\.log\) is missing/);
  assert.match(e, /unknown field "colour"/);
  assert.match(e, /"mostly ai" is not one of ai, human\+ai, human/);

  const root2 = repo();
  entry(root2, "submissions/J1J2/square_16_P_0.5/2026-10-08_example-lab_vit", TEMPLATE.replace("J1J2/square_100_P_0.5", "J1J2/square_16_P_0.5"));
  assert.match(run(root2).errors.join("\n"), /square_16_P_0\.5 is solved: QMBL has an exact energy/);

  const root3 = repo();
  entry(root3, "submissions/J1J2/square_7_P_0.5/2026-10-08_example-lab_vit", TEMPLATE.replace("J1J2/square_100_P_0.5", "J1J2/square_7_P_0.5"));
  assert.match(run(root3).errors.join("\n"), /square_7_P_0\.5 is not an instance of QMBL/);
});

test("an instance added to QMBL after the launch list takes entries", () => {
  const root = repo();
  entry(root, "submissions/J1J2/square_196_P_0.33/2026-10-08_example-lab_vit", TEMPLATE.replace("J1J2/square_100_P_0.5", "J1J2/square_196_P_0.33"));
  assert.deepEqual(run(root).errors, []);
});

test("every launch target is still an instance of QMBL", { skip: !fs.existsSync(path.join(QMBL_DIR, "scripts/summary.mjs")) && "no QMBL checkout at QMBL_DIR" }, async () => {
  const ids = await qmblIds(QMBL_DIR);
  const launch = JSON.parse(fs.readFileSync(path.join(REPO, "targets/v1.json"), "utf8")).instances.map(i => i.instance_id);
  assert.deepEqual(launch.filter(id => !ids.known.has(id)), []);
});

test("an error bar is asked for, not required", () => {
  const bare = TEMPLATE.split("\n").filter(l => !/^(sigma_per_site|sigma_method|samples):/.test(l)).join("\n");
  const root = repo(); entry(root, DIR, bare);
  assert.deepEqual(run(root).errors, []);
  const root2 = repo(); entry(root2, DIR, TEMPLATE.replace(/^sigma_method:.*\n/m, ""));
  assert.match(run(root2).errors.join("\n"), /sigma_method must say how it was estimated/);
});
test("state formats of the verifier", () => {
  const fw = (name, entryPoint) => TEMPLATE.replace('framework: "flax"', `framework: "${name}"`)
    .replace('entry_point: "model.py:build_model"', `entry_point: ${entryPoint}`);
  for (const [name, ep] of [["torch", '"model.py:Net"'], ["jax", '"model.py:make"'], ["python", '"state.py:logpsi"'],
    ["julia", '"state.jl"'], ["c", '"build/libstate.so"'], ["mps", "null"]]) {
    const root = repo(); entry(root, DIR, fw(name, ep));
    assert.deepEqual(run(root).errors, [], name);
  }
  const bad = [[fw("julia", '"model.py:make"'), /entry_point for julia is file\.jl/],
    [fw("mps", '"model.py:build_model"'), /an mps state has no entry_point/],
    [fw("torch", '"model.py:Net"').replace(/checkpoint_url: .*\n/, "checkpoint_url: null\n"), /needs checkpoint_url/],
    [TEMPLATE.replace(/checkpoint_sha256: .*\n/, "checkpoint_sha256: null\n"), /go together/],
    [fw("torch", '"model.py:Net"').replace("kernel: null", 'kernel: "k.py:make"'), /kernel goes with a flax state only/]];
  for (const [meta, err] of bad) { const root = repo(); entry(root, DIR, meta); assert.match(run(root).errors.join("\n"), err); }
});
test("one live entry per system and instance", () => {
  const root = repo();
  entry(root);
  entry(root, DIR.replace("2026-10-08_example-lab_vit", "2026-10-09_example-lab_vit-2"), TEMPLATE.replace('date: "2026-10-08"', 'date: "2026-10-09"'));
  assert.match(run(root).errors.join("\n"), /already has an entry on J1J2\/square_100_P_0\.5/);
});

test("deterministic states, dates, folder names, file size", () => {
  const root = repo();
  entry(root, DIR, TEMPLATE.replace('sigma_method: "blocking"', 'sigma_method: "deterministic"'));
  assert.match(run(root).errors.join("\n"), /a deterministic state has no sigma_per_site and no samples/);

  const root2 = repo();
  entry(root2, "submissions/J1J2/square_100_P_0.5/2026-10-08_Example Lab_ViT");
  assert.match(run(root2).errors.join("\n"), /folder name must be/);

  const root3 = repo();
  entry(root3, DIR, TEMPLATE, { "log.txt": "x", "state.msgpack": Buffer.alloc(5 * 1024 * 1024 + 1) });
  assert.match(run(root3).errors.join("\n"), /larger than 5 MB/);
});

test("results must belong to an entry", () => {
  const root = repo();
  entry(root);
  const res = "results/J1J2/square_100_P_0.5";
  fs.mkdirSync(path.join(root, res), { recursive: true });
  fs.writeFileSync(path.join(root, res, "2026-10-08_example-lab_vit.json"), JSON.stringify({ entry: DIR, instance_id: "J1J2/square_100_P_0.5" }));
  fs.writeFileSync(path.join(root, res, "2026-10-01_other_x.json"), JSON.stringify({ entry: "x", instance_id: "J1J2/square_100_P_0.5" }));
  const e = run(root).errors;
  assert.equal(e.length, 2, e.join("\n"));
  assert.match(e.join("\n"), /no entry submissions\/J1J2\/square_100_P_0\.5\/2026-10-01_other_x/);
});
