# Browser policy (installed by jev-browser)

BROWSER POLICY: any task touching a web page (click, type, navigate, scrape
dynamic content) MUST go through jev-browser. Snapshot with the browser MCP
into a file, then run `jev observe` + `jev step` (or `jev decide` + `jev text`)
before every page action. Never act on a page without a fresh Jev decision for
that exact snapshot, and never echo snapshots or action arrays into context —
pipe them through files. DONE requires visible evidence of every requirement.
