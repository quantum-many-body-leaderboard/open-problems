// Freeze the target list of a QMBL: Open Problems version from a QMBL release.
//
//   node scripts/freeze_targets.mjs <qmbl checkout at the release tag> <tag> <release DOI> <version>
//   e.g. node scripts/freeze_targets.mjs ../qmbl-v0.4.0 v0.4.0 10.5281/zenodo.23239245 v1
//
// A target is an instance of the release with no exact energy at all: 153 at v0.4.0, the
// number the QMBL data paper gives. One instance has an exact (stochastic) row that is flagged
// (tV/square_64_P_32_4, CT-QMC above a variational bound); it has an exact row, so it is not a
// target. The instance list is frozen here; the energy to beat is read from QMBL's live data
// whenever an entry is verified, so a number published after the freeze still counts.
//
// The energy to beat is QMBL's best variational energy: the lowest unflagged variational row,
// with or without sigma, never an extrapolation or a projection (2026-10-08). QMBL's
// own record is written next to it where an extrapolated or projected energy holds it.
//
// Energies are stored as QMBL stores them (totals; spin models in Pauli units) and per site in
// the convention qmbl.org prints (S.S per site for spins, total / N for fermions).
//
// No dependencies: QMBL's own modules are imported from the checkout. Which instances are
// targets, and what is recorded for each, is scripts/targets.mjs, the module the live list
// (validate.mjs, qmbl.org) uses too.
import fs from "node:fs";
import path from "node:path";
import { loadQmbl, openTargets } from "./targets.mjs";

const [qmbl, tag, doi, version] = process.argv.slice(2);
if (!qmbl || !tag || !doi || !version) {
  console.error("usage: node scripts/freeze_targets.mjs <qmbl checkout> <tag> <release DOI> <version>");
  process.exit(2);
}
const out = path.resolve("targets", `${version}.json`);
const { instances: all, perSiteDivisor } = await loadQmbl(qmbl);

const instances = openTargets(all, perSiteDivisor)
  .map(({ target, record, published_results, verifier, ...hamiltonian }) =>
    ({ ...hamiltonian, target_at_freeze: target, record_at_freeze: record, published_results, verifier }));

const frozen = {
  version,
  frozen: new Date().toISOString().slice(0, 10),
  qmbl_release: tag,
  qmbl_doi: doi,
  rule: "Every instance of the QMBL release with no exact energy. The energy to beat is QMBL's best variational energy (lowest unflagged variational row), read live from QMBL when an entry is verified; target_at_freeze is that energy on the freeze date.",
  count: instances.length,
  instances,
};
fs.writeFileSync(out, JSON.stringify(frozen, null, 1) + "\n");
const supported = instances.filter(i => i.verifier.supported).length;
console.log(`${out}: ${instances.length} instances, ${instances.filter(i => !i.target_at_freeze).length} without a variational energy, ${supported} supported by the verifier`);
