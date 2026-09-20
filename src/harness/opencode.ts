import { Plugin } from "@opencode/plugin";
import { choose } from "../core/jev.ts";
import { capActions, snapshotToActions } from "../core/elements.ts";
import { planStep } from "../core/step.ts";
import { fieldText } from "../core/text.ts";
import { nativeFieldText } from "./opencode-text.ts";

/**
 * Thin OpenCode adapter over the harness-agnostic core.
 *
 * Registers the jev tools in code mode so snapshots and action arrays never
 * enter the model context, plus the jev-browser skill, the /jev-browse
 * command, and the browser policy. Everything that decides lives in src/core;
 * this file only wires it to the plugin API.
 *
 * Text tiers, first hit wins:
 * 1. TEXT_MODEL_API_KEY — explicit OpenAI-compatible override.
 * 2. The calling session's selected model, through a managed helper session.
 * 3. A free OpenCode Zen model, through the same helper session.
 * 4. auth.json providers (anthropic / openai / openrouter / deepseek / go).
 */
export default Plugin.define({
  id: "jev-browser",
  async setup(ctx) {
    async function resolveFieldText(
      context: Record<string, unknown>,
      sessionID?: string,
    ): Promise<{ text: string; model: string }> {
      if (!process.env.TEXT_MODEL_API_KEY) {
        try {
          return await nativeFieldText(ctx, context, { sessionID });
        } catch {
          // No session or free model available; fall through to auth.json.
        }
      }
      const { text, meta } = await fieldText(context, { sessionID });
      return { text, model: meta.model };
    }

    await ctx.tool.transform((editor) => {
      editor.namespace({ name: "jev", description: "Jev decision step for browser automation" });

      editor.add({
        name: "decide",
        description:
          "Ask Jev (TypeSafe System One) for the next browser operation + target. " +
          "Call after snapshotting the page with chrome/brave MCP. Returns {choice, operation, target, probabilities}. " +
          "Never invents selectors or text.",
        input: {
          type: "object",
          properties: {
            goal: { type: "string", description: "Full user goal" },
            page: {
              type: "object",
              description: "{url, title, text, actions[]}. actions[] items: {id, kind: click|fill|select|control, node, label, role?, value?}",
              properties: {
                url: { type: "string" },
                title: { type: "string" },
                text: { type: "string" },
                fingerprint: { type: "string" },
                actions: { type: "array", items: { type: "object" } },
              },
              required: ["url", "title", "text", "actions"],
              additionalProperties: true,
            },
            history: {
              type: "array",
              description: "Recent {action, kind, text, page_changed}",
              items: { type: "object" },
            },
          },
          required: ["goal", "page"],
          additionalProperties: false,
        },
        options: { namespace: "jev", codemode: true },
        execute: async (input) => {
          const { goal, page, history } = input as {
            goal: string;
            page: any;
            history?: any[];
          };
          try {
            const decision = await choose(page, goal, history ?? []);
            return { content: JSON.stringify(decision) };
          } catch (err) {
            throw new Error(err instanceof Error ? err.message : String(err));
          }
        },
      });

      editor.add({
        name: "text",
        description:
          "Generate the exact string for a TYPE_TEXT target. Uses the session model, a free OpenCode Zen model, " +
          "or the configured small OpenAI-compatible model. " +
          "Input is fieldContext {goal, field, page, recent_actions}. Returns {text}. " +
          "Throws when no model or invalid JSON — never guess.",
        input: {
          type: "object",
          properties: {
            context: { type: "object", description: "fieldContext object" },
          },
          required: ["context"],
          additionalProperties: false,
        },
        options: { namespace: "jev", codemode: true },
        execute: async (input, toolCtx) => {
          const { context } = input as { context: Record<string, unknown> };
          return { content: JSON.stringify(await resolveFieldText(context, toolCtx.sessionID)) };
        },
      });

      editor.add({
        name: "observe",
        description:
          "Parse a raw chrome-devtools-mcp or Playwright accessibility snapshot into the actions[] list Jev " +
          "expects, capped per kind. Use inside a code-mode script so the raw snapshot and the action array " +
          "never enter the model context. Returns {page, actions, counts}.",
        input: {
          type: "object",
          properties: {
            snapshot: { type: "string", description: "Raw take_snapshot output" },
            url: { type: "string" },
            title: { type: "string" },
            text: { type: "string", description: "Visible page text (optional)" },
          },
          required: ["snapshot"],
          additionalProperties: false,
        },
        options: { namespace: "jev", codemode: true },
        execute: async (input) => {
          const { snapshot, url, title, text } = input as {
            snapshot: string;
            url?: string;
            title?: string;
            text?: string;
          };
          const actions = capActions(snapshotToActions(snapshot));
          const counts: Record<string, number> = {};
          for (const action of actions) counts[action.kind] = (counts[action.kind] ?? 0) + 1;
          return {
            content: JSON.stringify({
              page: { url: url ?? "", title: title ?? "", text: text ?? "" },
              actions,
              counts,
            }),
          };
        },
      });

      editor.add({
        name: "step",
        description:
          "One full cycle in a single call: picks the operation and target and resolves the exact text for " +
          "TYPE_TEXT. Returns {choice, operation, target, text, confidence, ...} — the harness still executes " +
          "the action. Prefer this over decide + text to halve round trips.",
        input: {
          type: "object",
          properties: {
            goal: { type: "string", description: "Full user goal" },
            page: {
              type: "object",
              description: "{url, title, text, actions[]}. actions[] items: {id, kind: click|fill|select|control, node, label, role?, value?}",
              properties: {
                url: { type: "string" },
                title: { type: "string" },
                text: { type: "string" },
                fingerprint: { type: "string" },
                actions: { type: "array", items: { type: "object" } },
              },
              required: ["url", "title", "text", "actions"],
              additionalProperties: true,
            },
            history: {
              type: "array",
              description: "Recent {action, kind, text, page_changed}",
              items: { type: "object" },
            },
          },
          required: ["goal", "page"],
          additionalProperties: false,
        },
        options: { namespace: "jev", codemode: true },
        execute: async (input, toolCtx) => {
          const { goal, page, history } = input as {
            goal: string;
            page: any;
            history?: any[];
          };
          let textModel: string | null = null;
          const result = await planStep(page, goal, history ?? [], {
            textFor: async (context) => {
              const resolved = await resolveFieldText(context, toolCtx.sessionID);
              textModel = resolved.model;
              return resolved.text;
            },
          });
          return { content: JSON.stringify({ ...result, text_model: textModel }) };
        },
      });
    });

    await ctx.skill.transform((editor) => {
      editor.add({
        id: "jev-browser" as any,
        name: "jev-browser" as any,
        description:
          "MANDATORY for any browser work (click, type, navigate, scrape dynamic pages): " +
          "snapshot with chrome MCP (fallback brave), then a fresh jev_step decision before every page action.",
        path: `${ctx.location.directory}/skill/SKILL.md` as any,
        autoinvoke: true,
        content:
          "Browser work must go through jev-browser: prefer one code-mode script with jev_observe + jev_step; " +
          "fall back to snapshot, jev_step/jev_decide, then act. See skill file for the loop.",
      });
    });

    // System-prompt rule on every agent-loop call so the model routes via Jev
    // instead of driving chrome/brave MCP tools directly.
    await ctx.session.hook("context", (event) => {
      event.system.push({
        type: "text",
        text:
          "BROWSER POLICY: any task touching a web page (click, type, navigate, scrape dynamic " +
          "content) MUST go through jev-browser: snapshot with chrome MCP (fallback brave), call " +
          "jev_step (or jev_decide) before every page action, jev_text for standalone TYPE_TEXT values. " +
          "Prefer one code-mode script with jev_observe + jev_step so snapshots stay out of context. " +
          "Never act on a page without a fresh jev decision for that exact snapshot.",
      });
    });

    await ctx.command.transform((editor) => {
      editor.add({
        name: "jev-browse",
        description: "Browse with Jev decisions + chrome/brave MCP actions",
        execute: async ({ sessionID, prompt, delivery }) => {
          await ctx.session.prompt({
            ...prompt,
            sessionID,
            delivery,
            text: `${prompt.text}\n\nFast path: run one code-mode script — chrome.take_snapshot → jev_observe → jev_step → verify freshness + visible target → act via MCP (wait <=200ms for suggestions else <=50ms) → repeat until DONE/BLOCKED or 60 steps. Fall back to step-by-step jev_step calls when a human must review each decision. DONE needs visible evidence of ALL requirements. See skill jev-browser.`,
          });
        },
      });
    });
  },
});
