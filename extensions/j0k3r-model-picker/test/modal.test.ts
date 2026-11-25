import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

const loaderCode = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@earendil-works/pi-tui") {
    return {
      shortCircuit: true,
      url: "data:text/javascript," + encodeURIComponent(\`
        export class Container { render() { return []; } invalidate() {} clear() {} addChild() {} }
      \`)
    };
  }
  return nextResolve(specifier, context);
}
`;

register("data:text/javascript," + encodeURIComponent(loaderCode));

const { ModelPickerModal } = await import("../src/modal.ts");
const { buildCatalog } = await import("../src/api.ts");

const ANSI = /\x1b\[[0-9;]*[a-zA-Z]/g;
const plain = (text: string) => text.replace(ANSI, "");

const theme = {
	fg: (_color: string, text: string) => `\x1b[38;2;0;229;255m${text}\x1b[0m`,
	bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
	italic: (text: string) => `\x1b[3m${text}\x1b[23m`,
};

function model(id: string, provider = "acme") {
	return {
		provider,
		id,
		name: id,
		contextWindow: 128000,
		cost: { input: 1, output: 2 },
	} as any;
}

const models = [model("acme/models/super-long-model-identifier-that-wraps"), model("acme/models/second-model")];

const catalog = buildCatalog(models, {
	getAvailable: () => models,
	getProviderAuthStatus: () => ({ configured: true }),
	getProviderDisplayName: (provider) =>
		provider === "acme" ? "Acme Provider With A Very Long Display Name That Wraps Across Lines" : provider,
}, false);

type Harness = { modal: any; selected: string[]; done: string[] };

async function createModal(): Promise<Harness> {
	const selected: string[] = [];
	const done: string[] = [];
	const modal = new ModelPickerModal({
		theme,
		tui: { requestRender: () => {} },
		done: () => done.push("done"),
		load: async () => catalog,
		select: async (picked: any) => {
			selected.push(picked.id);
			return undefined;
		},
		currentModel: models[0],
		maxHeight: 20,
	});
	await new Promise((resolve) => setImmediate(resolve));
	return { modal, selected, done };
}

/** Providers start collapsed; expand the single provider so model rows render. */
function expandProvider(modal: any, width: number): void {
	modal.render(width);
	modal.handleInput("\r");
	modal.render(width);
}

test("MINI-005: narrow widths wrap provider and model rows without ellipsis or clipped content", async () => {
	const { modal } = await createModal();
	const width = 30;
	expandProvider(modal, width);

	const lines = modal.render(width).map(plain) as string[];
	assert.ok(lines.length > 0);
	for (const line of lines) {
		assert.ok(line.length <= width, `line exceeds ${width}: ${JSON.stringify(line)}`);
		assert.doesNotMatch(line, /…/, "rows must wrap instead of clipping with an ellipsis");
	}

	const joined = lines.join("").replace(/[│\s]/g, "");
	assert.ok(joined.includes("ACME"), "provider label survives wrapping");
	assert.ok(joined.includes("VERYLONGDISPLAYNAMETHATWRAPS"), "full provider label survives wrapping");
	assert.ok(joined.includes("super-long-model-identifier-that-wraps"), "full model id survives wrapping");
});

test("MINI-005: every wrapped row line keeps its own click target and selection mapping", async () => {
	const width = 30;
	const { modal } = await createModal();
	expandProvider(modal, width);

	const lines = modal.render(width).map(plain) as string[];
	const providerStart = lines.findIndex((line) => line.includes("ACME"));
	assert.ok(providerStart >= 0, "provider row must render");
	// The provider row wraps onto the following visual line(s), which must not belong to a model row.
	assert.ok(
		!lines[providerStart + 1].includes("▸") && !lines[providerStart + 1].includes("models/"),
		"expected a wrapped continuation line for the provider row",
	);

	// Pressing a continuation line focuses and toggles the owning row.
	const pressed = modal.handleMouse({ type: "press", button: "left", x: 5, y: providerStart + 1 } as any);
	assert.equal(pressed?.handled, true);
	const collapsed = modal.render(width).map(plain) as string[];
	assert.ok(collapsed.some((line) => line.includes("▶")), "provider collapsed from the wrapped line click");
	assert.ok(!collapsed.join("").includes("second-model"), "collapsed provider hides its model rows");
});

test("MINI-005: wrapped footer buttons stay clickable on their rendered line", async () => {
	const { modal, done } = await createModal();
	const width = 24;
	const lines = modal.render(width).map(plain) as string[];
	for (const line of lines) assert.ok(line.length <= width, `line exceeds ${width}: ${JSON.stringify(line)}`);

	const closeRow = lines.findIndex((line) => line.includes("Cerrar"));
	assert.ok(closeRow >= 0, "close button must render");
	const pressed = modal.handleMouse({ type: "press", button: "left", x: 3, y: closeRow } as any);
	assert.equal(pressed?.handled, true);
	assert.deepEqual(done, ["done"], "pressing the rendered close button closes the picker");
});

test("MINI-005: keyboard selection and scroll range stay aligned with rendered rows", async () => {
	const { modal, selected } = await createModal();
	const width = 30;
	expandProvider(modal, width);

	// Down moves to the first model row; Enter selects it.
	modal.handleInput("\x1b[B");
	modal.handleInput("\r");
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(selected, [models[0]!.id]);

	const lines = modal.render(width).map(plain) as string[];
	const rangeLine = lines.find((line) => /\d+-\d+ de \d+/.test(line));
	assert.ok(rangeLine, "scroll range renders");
});
