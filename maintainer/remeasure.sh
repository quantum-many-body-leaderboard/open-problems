#!/usr/bin/env bash
# Re-measure one entry on a GPU host: fetch its code and checkpoint, check the checksum, measure
# the state twice with independent seeds and combine the two into entry.json.
#
#   maintainer/remeasure.sh <entry folder> <QMBL instance file> <work dir> [max hours per measurement]
#   e.g. VERIFIER=~/verifier maintainer/remeasure.sh submissions/J1J2/square_100_P_0.5/2026-10-08_lab_vit \
#            ~/qmbl/data/J1J2/square_100_P_0.5.json work/2026-10-08_lab_vit 4
#
# VERIFIER is a checkout of quantum-many-body-leaderboard/verifier (default: ../verifier next to
# this repository). Run it in the verifier's environment (its requirements.txt, plus
# requirements-torch/-julia/-mps.txt for those states) on a card picked by the host's own policy;
# the script never chooses a GPU. The QMBL instance file comes from a current QMBL checkout, so
# the energy to beat is the live one. Seeds are drawn here, not taken from the entry.
set -euo pipefail
entry=$1; inst=$2; work=$3; hours=${4:-4}
here=$(cd "$(dirname "$0")/.." && pwd)
verifier=${VERIFIER:-$here/../verifier}
[[ -f $verifier/op_verify.py ]] || { echo "no verifier at $verifier (set VERIFIER)" >&2; exit 2; }
verifier=$(cd "$verifier" && pwd)
meta="$entry/metadata.yaml"
[[ -f $meta ]] || { echo "no $meta" >&2; exit 2; }
field() { node --input-type=module -e "
import { parseYaml } from '$here/scripts/validate.mjs';
import fs from 'node:fs';
const m = parseYaml(fs.readFileSync('$meta', 'utf8'));
const v = '$1'.split('.').reduce((o, k) => o?.[k], m);
console.log(v ?? '');"; }

framework=$(field state.framework); entry_point=$(field state.entry_point); build=$(field state.build)
kernel=$(field state.kernel); code_url=$(field state.code_url)
ckpt_url=$(field state.checkpoint_url); sha=$(field state.checkpoint_sha256)
mkdir -p "$work"
work=$(cd "$work" && pwd)
# code_url is https://github.com/<owner>/<repo>/tree/<commit>
if [[ $code_url =~ ^https://github\.com/([^/]+)/([^/]+)/tree/([0-9a-f]{7,40})$ ]]; then
  repo="https://github.com/${BASH_REMATCH[1]}/${BASH_REMATCH[2]}.git"; commit=${BASH_REMATCH[3]}
  [[ -d $work/code/.git ]] || git clone --quiet "$repo" "$work/code"
  git -C "$work/code" checkout --quiet "$commit"
else
  echo "code_url must be https://github.com/<owner>/<repo>/tree/<commit>: $code_url" >&2; exit 2
fi
# The checkpoint keeps its file name: some loaders read the format from the extension (.npz, .msgpack).
params=()
if [[ -n $ckpt_url ]]; then
  ckpt="$work/$(basename "${ckpt_url%%\?*}")"
  [[ -f $ckpt ]] || curl -fsSL -o "$ckpt" "$ckpt_url"
  echo "$sha  $ckpt" | sha256sum -c --quiet || { echo "checkpoint checksum differs from metadata.yaml" >&2; exit 2; }
  params=(--params "$ckpt")
fi

seeds=($(od -An -N8 -tu4 /dev/urandom))
cd "$work/code"
[[ -n $build ]] && bash -c "$build"
for s in "${seeds[@]}"; do
  if [[ $framework == mps ]]; then
    python "$verifier/op_verify.py" mps-score --instance-file "$inst" --mps "$ckpt" --seed "$s" --out "$work/score_$s.json" || true
  else
    spec=$entry_point; [[ $framework != flax ]] && spec="$framework:$entry_point"
    args=(--instance-file "$inst" --state "$spec" "${params[@]}" --max-hours "$hours")
    [[ -n $kernel ]] && args+=(--kernel "$kernel")
    python "$verifier/op_verify.py" score "${args[@]}" --seed "$s" --out "$work/score_$s.json" || true
  fi
done
python "$verifier/op_verify.py" combine --instance-file "$inst" "$work/score_${seeds[0]}.json" "$work/score_${seeds[1]}.json" --out "$work/entry.json"
