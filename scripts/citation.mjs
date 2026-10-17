// The citation of a CITATION.cff, as README.md and qmbl.org/open-problems/ print it. A module of its
// own, with no imports: QMBL's scripts/open_problems.mjs reads it from this checkout, and
// readme.mjs imports open_problems.mjs, so the parser cannot live in readme.mjs.
//
// The citation: the title, the authors, the year of the latest release and the concept DOI, which
// always resolves to the latest release, from a CITATION.cff: this repository's own since its first
// Zenodo release (v0.1.0, 2026-10-17); before that it cited QMBL's.
export function citationOf(cff) {
  // The top-level authors block only: references: lists authors of its own.
  const block = cff.match(/^authors:\s*\n((?:[ \t]+.*\n?)*)/m)?.[1] ?? "";
  const authors = [...block.matchAll(/- family-names:\s*"?([^"\n]+?)"?\s*\n\s+given-names:\s*"?([^"\n]+?)"?\s*$/gm)]
    .map(([, family, given]) => `${given[0]}. ${family}`);
  const head = authors.length > 2 ? `${authors.slice(0, -1).join(", ")} and ${authors.at(-1)}` : authors.join(" and ");
  const doi = cff.match(/- type: doi\s*\n\s+value:\s*"?([^"\n]+?)"?\s*\n\s+description:\s*"?Concept DOI/)?.[1]
    ?? cff.match(/^doi:\s*"?([^"\n]+?)"?\s*$/m)?.[1];
  const year = cff.match(/^date-released:\s*"?(\d{4})/m)?.[1];
  const title = cff.match(/^title:\s*"?([^"\n]+?)"?\s*$/m)?.[1];
  if (!title || !head || !doi || !year) throw new Error("CITATION.cff: title, authors, concept DOI or date-released not found");
  return { title, head, doi, year };
}
