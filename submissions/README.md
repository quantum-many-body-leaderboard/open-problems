# Submissions

One folder per entry:

    submissions/<model>/<instance>/<YYYY-MM-DD>_<team>_<method>/
        metadata.yaml   from template/metadata.yaml
        README.md       from template/README.md
        log.txt         the output of your own measurement (or any *.log)

`<model>/<instance>` is the instance id of an open instance in QMBL (listed on
qmbl.org/open-problems/table/), e.g.
`submissions/J1J2/square_100_P_0.5/2026-10-08_example-lab_vit/`. Folder names are lower case with
words joined by hyphens. Checkpoints and samples do not go here: link them from `metadata.yaml`
(no file over 5 MB).
