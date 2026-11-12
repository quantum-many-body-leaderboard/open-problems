// The targets of QMBL: Open Problems, read from QMBL's current data (2026-10-09:
// rolling problems). Every QMBL instance with no exact energy at all is a target: an instance
// added to QMBL without an exact energy is a target from the day it is added, and an instance
// that gets an exact energy is solved and takes no new entries (entries already on it stay
// listed). targets/v1.json is the list of QMBL v0.4.0, kept as a snapshot (freeze_targets.mjs).
//
// Used by validate.mjs (which instances take entries), freeze_targets.mjs, and the site build
// (QMBL's scripts/open_problems.mjs, which imports this file from the checkout beside it).
//
// The energy to beat is QMBL's best variational energy: the lowest unflagged variational row,
// with or without sigma, never an extrapolation or a projection (2026-10-08). QMBL's
// own record is given next to it where an extrapolated or projected energy holds it. Energies
// are stored as QMBL stores them (totals; spin models in Pauli units) and per site in the
// convention qmbl.org prints (S.S per site for spins, total / N for fermions).
//
// No dependencies: QMBL's own modules are imported from its checkout.
import path from "node:path";
import { pathToFileURL } from "node:url";

// An exact row of any kind, flagged or not, means the instance is solved: tV/square_64_P_32_4
// has a flagged exact (stochastic) row, so it is not a target.
export const isSolved = inst => inst.rows.some(r => r.bound_type === "exact");

// What the verifier (quantum-many-body-leaderboard/verifier) can build today (qrec_verify/hamiltonians.py `build`;
// the electron gas since v1.8: qrec_verify/continuum.py, the cells of QMBL's checks/heg-hf/hf.mjs).
const HEG_CELLS = /^(sc|bcc|fcc|square|triangular|rect-\d+(\.\d+)?(x\d+(\.\d+)?){1,2})$/;
// verifier v1.10.1 (quantum-many-body-leaderboard/verifier 7f4abb8): which QMBL instances it can build. Mirrors
// qrec_verify/instance.py (spin clusters), tj.py (t-J clusters), chem.py and chem_large.py (hydrogen), molecule.py and impurity.py.
const isSquareN = n => Number.isInteger(Math.sqrt(n));
const AO_PER_H = { "sto-3g": 1, "sto-6g": 1, "6-31g": 2, "cc-pvdz": 5, "cc-pvtz": 14, "cc-pvqz": 30, "cc-pv5z": 55,
                   "aug-cc-pvdz": 9, "aug-cc-pvtz": 23, "aug-cc-pvqz": 46 };
const MAX_ORBITALS = 128;            // qrec_verify/chem.py MAX_ORBITALS
const MAX_CHOLESKY_ORBITALS = 850;   // v1.10: largest n with chem_large.estimate_gb(n) <= chem_large.MAX_GB (64)
// v1.10: Gaussian-basis chains above 128 orbitals whose overlap matrix has an eigenvalue below 1e-10 (chem.loewdin
// refuses them; computed with pyscf, work/logs/r2_large_basis.tsv), keyed model:n_sites:basis:R
const NEARLY_SINGULAR = new Set(["Hchain:10:aug-cc-pvqz:1", "Hchain:10:aug-cc-pvtz:1", "Hchain:10:cc-pv5z:1",
  "Hchain:30:cc-pvdz:1", "Hchain:30:cc-pvdz:1.2", "Hchain:30:cc-pvtz:1", "Hchain:30:cc-pvtz:1.2",
  "Hchain:50:cc-pvdz:1", "Hchain:50:cc-pvdz:1.2", "Hchain:50:cc-pvtz:1", "Hchain:50:cc-pvtz:1.2",
  "Hchain:50:cc-pvtz:1.4"]);

function spinCluster(inst) {
  // the Heisenberg-type clusters of qrec_verify/instance.py (triangular_dims, frustrated_dims) and lattice_dims
  const n = inst.n_sites, b = inst.boundary ?? "P", lat = inst.lattice;
  if (lat === "square" || /^rectangular-\d+x\d+$/.test(lat)) return lat === "square" ? isSquareN(n) : true;
  if (lat === "triangular") {
    if (isSquareN(n) && (b === "P" || b === "O")) return true;
    return b === "P" && Number.isInteger(Math.sqrt(n / 3));
  }
  if (b !== "P") return false;
  let m;
  if ((m = lat.match(/^kagome-(\d+)x(\d+)$/))) return 3 * m[1] * m[2] === n;
  if ((m = lat.match(/^honeycomb-(\d+)x(\d+)$/))) return 2 * m[1] * m[2] === n;
  if ((m = lat.match(/^pyrochlore-(\d+)x(\d+)x(\d+)$/))) { const c = m[1] * m[2] * m[3]; return n === 4 * c || n === 16 * c; }
  if (lat === "shuriken") return Number.isInteger(Math.sqrt(n / 6));
  return false;
}

export function verifierSupport(inst) {
  const no = reason => ({ supported: false, reason });
  if (inst.model === "HEG2D" || inst.model === "HEG3D")
    return HEG_CELLS.test(inst.lattice) ? { supported: true } : no(`${inst.lattice} cell`);
  const flat = inst.lattice === "square" || /^rectangular-\d+x\d+$/.test(inst.lattice);
  const b = inst.boundary ?? "P";
  if (inst.model === "Hubbard") return flat ? { supported: true } : no(`${inst.lattice} lattice`);
  if (inst.model === "J1J2" || inst.model === "Heisenberg") {
    if (/A/.test(b)) return no("antiperiodic spin boundary");
    if (!spinCluster(inst)) return no(`${inst.lattice} lattice`);
    // J2 bonds exist on the square, rectangular, triangular and honeycomb lattices
    if (inst.model === "J1J2" && !(flat || inst.lattice === "triangular" || /^honeycomb-/.test(inst.lattice)))
      return no(`J1-J2 on the ${inst.lattice} lattice`);
    return { supported: true };
  }
  if (inst.model === "ShastrySutherland") {
    const L = Math.sqrt(inst.n_sites);
    return inst.lattice === "square" && Number.isInteger(L) && L % 2 === 0 && L >= 4 && (b === "P" || b === "O")
      ? { supported: true } : no(`${inst.lattice} cluster`);
  }
  if (inst.model === "TFIsing") {
    if (/A/.test(b)) return no("antiperiodic boundary");
    return flat || inst.lattice === "chain" ? { supported: true } : no(`${inst.lattice} lattice`);
  }
  if (inst.model === "tJ") {
    if (!inst.params?.nn_term) return no("t-J without the n n / 4 term");
    const n = inst.n_sites, lat = inst.lattice;
    if (lat === "square") {
      if (isSquareN(n)) return b === "P" || b === "O" ? { supported: true } : no(`boundary ${b}`);
      let shapes = 0;
      for (let a = 1; a * a <= n; a++) { const c = Math.sqrt(n - a * a); if (Number.isInteger(c) && c <= a) shapes++; }
      return b === "P" && shapes === 1 ? { supported: true } : no("square cluster shape");
    }
    if (/^rectangular-\d+x\d+$/.test(lat)) return { supported: true };
    if (/^ladder-\d+x\d+$/.test(lat)) return b === "P" || b === "A" ? { supported: true } : no(`boundary ${b}`);
    if (lat === "honeycomb-flake24") return { supported: true };
    return no(`${lat} cluster`);
  }
  if (inst.model === "Hchain" || inst.model === "Hsheet") {
    const basis = String(inst.params?.basis ?? "none").toLowerCase();
    if (b !== "O") return no("periodic cell");
    // v1.10: continuous space (qrec_verify/molecule.py): open chains and square sheets
    if (basis === "none")
      return inst.model === "Hchain" || isSquareN(inst.n_sites) ? { supported: true } : no("sheet shape");
    if (inst.n_sites % 2) return no("odd electron number");
    const per = AO_PER_H[basis];
    if (per == null) return no(`basis ${inst.params.basis}`);
    const n = per * inst.n_sites;
    if (n <= MAX_ORBITALS) return { supported: true };
    // v1.10: above 128 orbitals, Cholesky-factorised integrals (qrec_verify/chem_large.py); determinant states only
    if (n > MAX_CHOLESKY_ORBITALS) return no(`${n} orbitals (Cholesky vectors above 64 GB)`);
    if (NEARLY_SINGULAR.has(`${inst.model}:${inst.n_sites}:${basis}:${inst.params.R}`))
      return no("nearly linearly dependent basis (overlap eigenvalue below 1e-10)");
    return { supported: true, note: "Slater-determinant states (det:) only above 128 orbitals" };
  }
  if (inst.model === "Impurity")
    return /^(SB-IMP|SB-DMFT-MT-HF|SB-DMFT-MT-AHF|SB-DMFT-MI-HF|TB-DMFT|TB-DMFT-SOC)$/.test(inst.lattice)   // v1.10: + SOC
      ? { supported: true } : no(`${inst.lattice} impurity model`);
  return no(`${inst.model} model`);
}

const lowest = rows => [...rows].sort((a, b) => a.energy - b.energy)[0] ?? null;

function summaryOf(row, inst, perSiteDivisor) {
  if (!row) return null;
  const d = perSiteDivisor(inst);
  return {
    energy: row.energy,
    sigma: row.sigma ?? null,
    energy_per_site: d == null ? null : row.energy / d,
    sigma_per_site: d == null || row.sigma == null ? null : row.sigma / d,
    bound_type: row.bound_type,
    method: row.method,
    reference: row.reference,
  };
}

// One instance as a target: its Hamiltonian, the energy to beat in QMBL's data now, QMBL's
// record beside it where that is not the energy to beat, and whether the verifier can measure it.
export function targetOf(inst, perSiteDivisor) {
  const unflagged = inst.rows.filter(r => !r.defect);
  const target = lowest(unflagged.filter(r => r.bound_type === "variational"));
  const record = lowest(unflagged.filter(r => ["variational", "projected", "extrapolated"].includes(r.bound_type)));
  return {
    instance_id: inst.instance_id,
    model: inst.model,
    lattice: inst.lattice,
    n_sites: inst.n_sites,
    boundary: inst.boundary ?? null,
    params: inst.params,
    per_site_divisor: perSiteDivisor(inst),
    target: summaryOf(target, inst, perSiteDivisor),
    record: record && record !== target ? summaryOf(record, inst, perSiteDivisor) : null,
    published_results: inst.rows.length,
    verifier: verifierSupport(inst),
  };
}

// Every open instance, in QMBL's order.
export const openTargets = (instances, perSiteDivisor) => instances.filter(i => !isSolved(i)).map(i => targetOf(i, perSiteDivisor));

// QMBL's instances and its per-site divisor, from a checkout of its repository. collect()
// reads data/ relative to the working directory, which is restored afterwards.
export async function loadQmbl(dir) {
  const root = path.resolve(dir);
  const { collect } = await import(pathToFileURL(path.join(root, "scripts/summary.mjs")).href);
  const { perSiteDivisor } = await import(pathToFileURL(path.join(root, "scripts/units.mjs")).href);
  const cwd = process.cwd();
  process.chdir(root);
  try { return { instances: collect(), perSiteDivisor }; } finally { process.chdir(cwd); }
}
