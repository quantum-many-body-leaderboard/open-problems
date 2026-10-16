# Results

One JSON file per entry, `results/<model>/<instance>/<entry>.json`, written by QMBL with
`maintainer/publish.mjs` after re-measuring the entry's state. An entry that did not verify has
`verified: false` and its reasons in `flags`. qmbl.org/open-problems/ is built
from these files and QMBL's data. Contributors never edit this folder.
