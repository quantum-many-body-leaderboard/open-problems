// Check every entry under submissions/ and every file under results/.
//
//   node scripts/validate.mjs            (the whole repository; CI runs this on every pull request)
//
// An entry must be on an open instance: one in QMBL's current data with no exact energy
// (scripts/targets.mjs). QMBL's data comes from a checkout of its repository at QMBL_DIR,
// by default ../qmbl beside this one; CI checks it out into qmbl/.
//
// No dependencies. metadata.yaml is read by a small parser for the plain YAML the template uses
// (key: value, nested blocks indented by two spaces, # comments, quoted or plain scalars); anything
// beyond that is rejected with a message rather than guessed at. The fields are checked against
// schema/metadata.schema.json (the keywords listed in its description).
import fs from "node:fs";
import path from "node:path";
import { loadQmbl, isSolved } from "./targets.mjs";

const ENTRY_DIR = /^(\d{4}-\d{2}-\d{2})_[a-z0-9]+(?:-[a-z0-9]+)*_[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_FILE_BYTES = 5 * 1024 * 1024; // checkpoints and samples live elsewhere, linked from metadata
const LOG = name => name === "log.txt" || name.endsWith(".log");

// ---------------------------------------------------------------- plain YAML
function scalar(raw, where) {
  const s = raw.trim();
  if (s === "" || s === "~" || s === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (s.startsWith('"')) {
    try { return JSON.parse(s); } catch { throw new Error(`${where}: bad double-quoted string ${s}`); }
  }
  if (s.startsWith("'")) {
    if (!s.endsWith("'") || s.length < 2) throw new Error(`${where}: bad single-quoted string ${s}`);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s);
  if (/^[[{&*!|>%@`]/.test(s)) throw new Error(`${where}: "${s}" uses YAML beyond the plain subset; quote it`);
  return s;
}

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

export function parseYaml(text, file = "metadata.yaml") {
  const root = {};
  const stack = [{ indent: -1, obj: root }];
  text.split(/\r?\n/).forEach((raw, n) => {
    const where = `${file}:${n + 1}`;
    if (/\t/.test(raw.match(/^\s*/)[0])) throw new Error(`${where}: indent with spaces, not tabs`);
    const line = stripComment(raw).replace(/\s+$/, "");
    if (!line.trim()) return;
    const indent = line.match(/^ */)[0].length;
    if (indent % 2) throw new Error(`${where}: indent by two spaces`);
    const body = line.slice(indent);
    if (body.startsWith("- ") || body === "-") throw new Error(`${where}: lists are not used in metadata.yaml`);
    const m = body.match(/^([A-Za-z_][A-Za-z0-9_]*):(?:\s+(.*))?$/);
    if (!m) throw new Error(`${where}: expected "key: value"`);
    while (stack.at(-1).indent >= indent) stack.pop();
    const parent = stack.at(-1);
    if (Object.hasOwn(parent.obj, m[1])) throw new Error(`${where}: "${m[1]}" given twice`);
    if (m[2] === undefined || m[2].trim() === "") {
      const child = {};
      parent.obj[m[1]] = child;
      stack.push({ indent, obj: child, key: m[1] });
    } else parent.obj[m[1]] = scalar(m[2], where);
  });
  // a key with an empty block and no children is a null, as in YAML
  const nullEmpty = o => { for (const [k, v] of Object.entries(o)) if (v && typeof v === "object") { if (!Object.keys(v).length) o[k] = null; else nullEmpty(v); } };
  nullEmpty(root);
  return root;
}

// ---------------------------------------------------------------- schema subset
const typeOf = v => v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v;
const typeOk = (v, t) => t === typeOf(v) || (t === "number" && typeof v === "number");

export function checkSchema(value, schema, where, errors) {
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.some(t => typeOk(value, t))) {
      errors.push(`${where}: expected ${types.join(" or ")}, got ${typeOf(value)}`);
      return;
    }
  }
  if (value === null) return;
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${where}: "${value}" is not one of ${schema.enum.join(", ")}`);
  if (typeof value === "string") {
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${where}: too short`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${where}: "${value}" does not match ${schema.pattern}`);
  }
  if (typeof value === "number" && schema.minimum != null && value < schema.minimum) errors.push(`${where}: below ${schema.minimum}`);
  if (typeOf(value) === "object") {
    for (const k of schema.required ?? []) if (!(k in value)) errors.push(`${where}: "${k}" is missing`);
    for (const [k, v] of Object.entries(value)) {
      const sub = schema.properties?.[k];
      if (sub) checkSchema(v, sub, `${where}.${k}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${where}: unknown field "${k}"`);
    }
  }
}

// ---------------------------------------------------------------- repository
const walk = dir => fs.existsSync(dir)
  ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)])
  : [];

// `qmbl` holds QMBL's instance ids: `known`, every instance, and `open`, those with no exact
// energy (qmblIds below).
export function validate(root, qmbl) {
  const errors = [];
  const at = p => path.join(root, p);
  const schema = JSON.parse(fs.readFileSync(at("schema/metadata.schema.json"), "utf8"));
  const template = fs.readFileSync(at("template/README.md"), "utf8");

  // submissions/<model>/<instance>/<entry>/<file>
  const entries = new Map();
  for (const file of walk(at("submissions"))) {
    const rel = path.relative(at("submissions"), file).split(path.sep);
    if (rel.length === 1 && rel[0] === "README.md") continue;
    if (rel.length !== 4) { errors.push(`submissions/${rel.join("/")}: files go in submissions/<model>/<instance>/<YYYY-MM-DD>_<team>_<method>/`); continue; }
    const dir = rel.slice(0, 3).join("/");
    if (!entries.has(dir)) entries.set(dir, []);
    entries.get(dir).push(rel[3]);
    if (fs.statSync(file).size > MAX_FILE_BYTES) errors.push(`submissions/${rel.join("/")}: larger than 5 MB; link checkpoints and samples from metadata.yaml instead`);
  }

  const live = new Map();
  for (const [dir, files] of entries) {
    const where = `submissions/${dir}`;
    const [model, name, entry] = dir.split("/");
    const m = entry.match(ENTRY_DIR);
    if (!m) errors.push(`${where}: the folder name must be <YYYY-MM-DD>_<team>_<method>, lower case, words joined by hyphens`);
    if (!qmbl.known.has(`${model}/${name}`)) errors.push(`${where}: ${model}/${name} is not an instance of QMBL`);
    else if (!qmbl.open.has(`${model}/${name}`)) errors.push(`${where}: ${model}/${name} is solved: QMBL has an exact energy for it, so it takes no new entries`);
    if (!files.includes("README.md")) errors.push(`${where}: README.md is missing`);
    else {
      const readme = fs.readFileSync(at(`${where}/README.md`), "utf8").trim();
      if (readme.length < 40 || readme === template.trim()) errors.push(`${where}/README.md: describe the state and the measurement (see template/README.md)`);
    }
    if (!files.some(LOG)) errors.push(`${where}: the measurement log (log.txt or *.log) is missing`);
    if (!files.includes("metadata.yaml")) { errors.push(`${where}: metadata.yaml is missing`); continue; }
    let meta;
    try { meta = parseYaml(fs.readFileSync(at(`${where}/metadata.yaml`), "utf8"), `${where}/metadata.yaml`); }
    catch (e) { errors.push(e.message); continue; }
    const before = errors.length;
    checkSchema(meta, schema, `${where}/metadata.yaml`, errors);
    if (errors.length > before) continue;
    if (meta.instance !== `${model}/${name}`) errors.push(`${where}/metadata.yaml: instance "${meta.instance}" but the folder is ${model}/${name}`);
    if (m && meta.date !== m[1]) errors.push(`${where}/metadata.yaml: date ${meta.date} but the folder says ${m[1]}`);
    // An error bar is asked for, not required (RULES.md section 6, 2026-10-08 and 2026-10-12);
    // where one is given, it says how it was estimated.
    if (meta.sigma_method === "deterministic" && (meta.sigma_per_site != null || meta.samples != null))
      errors.push(`${where}/metadata.yaml: a deterministic state has no sigma_per_site and no samples (null or left out)`);
    if (meta.sigma_per_site != null && (meta.sigma_method == null || meta.sigma_method === "deterministic"))
      errors.push(`${where}/metadata.yaml: sigma_per_site is given, so sigma_method must say how it was estimated`);
    // The state formats of the verifier (its README, "The state you submit"; 2026-10-15).
    const s = meta.state, fw = s.framework;
    const form = { flax: /\.py:/, torch: /\.py:/, jax: /\.py:/, python: /\.py:/, julia: /\.jl$/, c: /\.so$/ }[fw];
    if (fw === "mps" && s.entry_point != null) errors.push(`${where}/metadata.yaml: an mps state has no entry_point; the file is checkpoint_url`);
    if (form && (s.entry_point == null || !form.test(s.entry_point)))
      errors.push(`${where}/metadata.yaml: state.entry_point for ${fw} is ${fw === "julia" ? "file.jl" : fw === "c" ? "the built lib.so" : "file.py:NAME"}`);
    if (["flax", "torch", "jax", "mps"].includes(fw) && s.checkpoint_url == null)
      errors.push(`${where}/metadata.yaml: a ${fw} state needs checkpoint_url`);
    if ((s.checkpoint_url == null) !== (s.checkpoint_sha256 == null))
      errors.push(`${where}/metadata.yaml: checkpoint_url and checkpoint_sha256 go together`);
    if (s.kernel != null && fw !== "flax") errors.push(`${where}/metadata.yaml: a local-energy kernel goes with a flax state only`);
    if (meta.compute && meta.compute.gpu_hours == null && meta.compute.cpu_core_hours == null)
      errors.push(`${where}/metadata.yaml: give compute.gpu_hours or compute.cpu_core_hours`);
    const key = `${meta.system.trim().toLowerCase()}\u0000${meta.instance}`;
    if (live.has(key)) errors.push(`${where}: ${meta.system} already has an entry on ${meta.instance} (${live.get(key)}); one live entry per system and instance - remove the old one in the same pull request`);
    else live.set(key, where);
  }

  // results/<model>/<instance>/<entry>.json, written by QMBL after re-measuring an entry
  for (const file of walk(at("results"))) {
    const rel = path.relative(at("results"), file).split(path.sep);
    if (rel.length === 1 && rel[0] === "README.md") continue;
    const where = `results/${rel.join("/")}`;
    if (rel.length !== 3 || !rel[2].endsWith(".json")) { errors.push(`${where}: results go in results/<model>/<instance>/<entry>.json`); continue; }
    let r;
    try { r = JSON.parse(fs.readFileSync(file, "utf8")); } catch { errors.push(`${where}: not JSON`); continue; }
    const dir = `${rel[0]}/${rel[1]}/${rel[2].slice(0, -5)}`;
    if (!entries.has(dir)) errors.push(`${where}: no entry submissions/${dir}`);
    if (r.entry !== `submissions/${dir}`) errors.push(`${where}: "entry" should be submissions/${dir}`);
    if (r.instance_id !== `${rel[0]}/${rel[1]}`) errors.push(`${where}: instance_id should be ${rel[0]}/${rel[1]}`);
  }
  return { errors, entries: entries.size };
}

// Every instance id in a QMBL checkout, and the open ones.
export async function qmblIds(dir) {
  const { instances } = await loadQmbl(dir);
  return { known: new Set(instances.map(i => i.instance_id)), open: new Set(instances.filter(i => !isSolved(i)).map(i => i.instance_id)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] ?? ".";
  const { errors, entries } = validate(root, await qmblIds(process.env.QMBL_DIR ?? path.join(root, "..", "qmbl")));
  if (errors.length) {
    console.error(errors.map(e => `- ${e}`).join("\n"));
    console.error(`${errors.length} problem${errors.length === 1 ? "" : "s"} in ${entries} entr${entries === 1 ? "y" : "ies"}`);
    process.exit(1);
  }
  console.log(`ok: ${entries} entr${entries === 1 ? "y" : "ies"}`);
}
