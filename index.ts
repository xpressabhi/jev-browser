import { Plugin } from "@opencode/plugin";
import { choose } from "./src/core/jev.ts";
import { fieldText } from "./src/core/text.ts";
import { nativeFieldText } from "./src/harness/opencode-text.ts";

export default Plugin.define({
  id: "jev-browser",
  async setup(ctx) {
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
          "Generate the exact string for a TYPE_TEXT target. Uses a free OpenCode Zen model " +
          "when one is available, otherwise the configured small OpenAI-compatible model. " +
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
        execute: async (input) => {
          const { context } = input as { context: Record<string, unknown> };
          if (!process.env.TEXT_MODEL_API_KEY) {
            try {
              const free = await nativeFieldText(ctx, context);
              return { content: JSON.stringify(free) };
            } catch {
              // Free Zen models are unavailable; fall through to the configured provider.
            }
          }
          const { text, meta } = await fieldText(context);
          return { content: JSON.stringify({ text, model: meta.model }) };
        },
      });
    });

    await ctx.skill.transform((editor) => {
      editor.add({
        id: "jev-browser" as any,
        name: "jev-browser" as any,
        description:
          "MANDATORY for any browser work (click, type, navigate, scrape dynamic pages): " +
          "snapshot with chrome MCP (fallback brave), then jev_decide before every page action.",
        path: `${ctx.location.directory}/skill/SKILL.md` as any,
        autoinvoke: true,
        content:
          "Browser work must go through jev-browser: snapshot, jev_decide, then act. See skill file for the loop.",
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
          "jev_decide before every page action, jev_text for TYPE_TEXT values. Never act on a page " +
          "without a fresh jev decision for that exact snapshot.",
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
            text: `${prompt.text}\n\nLoop: (1) snapshot page with chrome MCP (fallback brave), build actions[] {id,kind,node,label}. (2) call jev_decide. (3) on TYPE_TEXT call jev_text. (4) verify page freshness + target visible, act via MCP, wait <=200ms for suggestions else <=50ms. (5) repeat until decision is DONE/BLOCKED or 60 steps. DONE needs visible evidence of ALL requirements. See skill jev-browser.`,
          });
        },
      });
    });
  },
});
