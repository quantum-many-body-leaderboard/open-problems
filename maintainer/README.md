# Maintainer flow

How QMBL turns a pull request into a listed entry. Contributors do not need any of this.

1. **Format.** CI (`.github/workflows/validate.yml`) runs `scripts/validate.mjs` on the pull
   request. Nothing else happens until it passes.
2. **Limits.** One live entry per system and instance (CI checks it). Each of the two
   measurements runs at most 4 GPU-hours (`<max hours>` = 4 below).
3. **Re-measure** on a GPU host with a checkout of the [verifier](https://github.com/quantum-many-body-leaderboard/verifier), in its environment
   (`requirements.txt`, plus `requirements-torch.txt`, `-julia.txt` or `-mps.txt` for those
   states), on a card the host's own policy picks:

       VERIFIER=<verifier checkout> maintainer/remeasure.sh <entry folder> <qmbl>/data/<model>/<instance>.json work/<entry> <max hours>

   It clones the code at the stated commit, runs `state.build` if there is one, downloads the
   checkpoint, checks its SHA-256, measures the state twice (`mps-score` for an MPS file) with seeds drawn on the spot and runs `op_verify.py combine`. The instance file
   comes from a current QMBL checkout, so the energy to beat is the live one.
4. **Decide.** `work/<entry>/entry.json` says `verified: true` only if both measurements qualify
   (every gate passes or warns, the verifier's `DESIGN.md`) and agree within 2.5 sigma, and the energy is
   not below an exact one. Below a projected or extrapolated energy is allowed, but the entry lists
   those references; a second measurement with a different sampler comes before any public claim.
5. **Publish** every entry, verified or not:

       node maintainer/publish.mjs <entry folder> work/<entry>/entry.json <pull request URL>

   writes `results/<model>/<instance>/<entry>.json`. Commit it to the pull request's branch (or
   right after merging), merge, then start the qmbl.org build (`pages` workflow, `workflow_dispatch`
   on quantum-many-body-leaderboard/quantum-many-body-leaderboard), which reads `targets/` and
   `results/` from this repository. The README's leaderboard follows without a hand step: the merge
   changes `results/`, which starts `.github/workflows/readme.yml`. An entry that does not verify is
   listed with the problems from `entry.json` as its flags (2026-10-12): it takes no
   record mark and does not count in its system's score. The problems also go into the review.
6. **Records.** An entry below the target by more than 2 sigma combined is marked as a new record
   on the page. Before saying so anywhere else, re-check the papers citing the instance for a newer
   published energy, as for any record in QMBL.
