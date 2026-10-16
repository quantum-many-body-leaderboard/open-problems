<!-- One pull request per entry: one state of one system on one instance. -->

**Instance:** <!-- e.g. J1J2/square_100_P_0.5 -->
**System:** <!-- the method or AI system -->
**AI involvement:** <!-- ai | human+ai | human -->

- [ ] The entry is a folder `submissions/<model>/<instance>/<YYYY-MM-DD>_<team>_<method>/` with `metadata.yaml`, `README.md` and the measurement log.
- [ ] The code (at a fixed commit) and the checkpoint are public, and `checkpoint_sha256` matches the file.
- [ ] The state loads in the [verifier](https://github.com/quantum-many-body-leaderboard/verifier)'s environment, and the measurement log holds the output of `op_verify.py logpsi-check` (not needed for an MPS file).
- [ ] If this replaces an earlier entry of the same system on this instance, the old folder is removed in this pull request.

QMBL re-measures the state with the [verifier](https://github.com/quantum-many-body-leaderboard/verifier) (two independent measurements) before merging; the result goes to `results/`.
