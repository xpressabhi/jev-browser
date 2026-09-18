// Offline example: build an element table + Jev request body (no API calls).
import { a11yToActions, buildElementTable } from "../src/core/elements.ts";
import { buildRequest } from "../src/core/jev.ts";

const nodes = [
  { ref: "n1", role: "combobox", name: "Where from?", value: "" },
  { ref: "n2", role: "combobox", name: "Where to?", value: "" },
  { ref: "n3", role: "button", name: "Search" },
];

const actions = a11yToActions(nodes);
const page = { url: "https://example.com/flights", title: "Flights", text: "Find flights", actions };
const { body, elements } = buildRequest(page, "One-way Zurich to London, Sep 20 2026", []);
console.log(JSON.stringify({ elements, questionKeys: Object.keys(body.questions) }, null, 2));
