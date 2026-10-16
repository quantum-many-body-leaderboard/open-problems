# <System> on <instance>

What the state is, in a few sentences: the ansatz, its size (parameters), how it was trained
(optimiser, steps, samples per step, symmetries used), and anything a reader needs to rerun it.
If the state starts from another entry's checkpoint, name that entry. Give the licence of the code
and the checkpoint, if they have one.

## Measurement

How `energy_per_site` and `sigma_per_site` in `metadata.yaml` were measured: sampler, number of
chains, burn-in, samples, how sigma was estimated. The raw output goes in `log.txt` next to this file,
together with the output of the verifier's `op_verify.py logpsi-check` (not needed for an MPS file).

## AI involvement

What the AI system did and what people did, in one or two sentences.
