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

// What the verifier (quantum-many-body-leaderboard/verifier) can build today (qrec_verify/hamiltonians.py `build`).
export function verifierSupport(inst) {
  const flat = inst.lattice === "square" || /^rectangular-\d+x\d+$/.test(inst.lattice);
  if (inst.model === "Hubbard") return flat ? { supported: true } : { supported: false, reason: `${inst.lattice} lattice` };
  if (inst.model === "J1J2" || inst.model === "Heisenberg") {
    if (!flat) return { supported: false, reason: `${inst.lattice} lattice` };
    if (/A/.test(inst.boundary ?? "")) return { supported: false, reason: "antiperiodic spin boundary" };
    return { supported: true };
  }
  return { supported: false, reason: `${inst.model} model` };
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
