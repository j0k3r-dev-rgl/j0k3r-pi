import { test } from "node:test";
import assert from "node:assert/strict";
import registerProvider from "../cliproxyapi-dynamic-provider.ts";

function setup() {
    const hooks = new Map<string, Function>();
    registerProvider({
        registerProvider() {},
        on(name: string, handler: Function) { hooks.set(name, handler); },
    } as never);
    return hooks.get("before_provider_request");
}

const mwapi = { model: { provider: "cliproxyapi", id: "mwapi/claude-opus-5-5" } };
function payload() {
    return {
        model: mwapi.model.id,
        messages: [{ role: "user", content: "Hello" }],
        tools: [{
            type: "function",
            function: {
                name: "lookup", description: "Look up a source",
                parameters: {
                    type: "object", required: ["source"],
                    properties: {
                        source: { type: "string", enum: ["a", "b"] },
                        value: { oneOf: [{ type: "string" }, { type: "number" }] },
                    },
                    oneOf: [
                        { properties: { source: { const: "a" } } },
                        { properties: { source: { const: "b" } } },
                    ],
                },
            },
        }],
    };
}

test("registers a request compatibility hook", () => {
    assert.equal(typeof setup(), "function");
});

test("MWAPI omits only root oneOf while retaining the full object contract and nested unions", () => {
    const original = payload();
    const before = structuredClone(original);
    const hook = setup();
    assert.ok(hook);
    const result = hook({ payload: original }, mwapi);
    assert.ok(result);
    const expected = structuredClone(before);
    delete (expected.tools[0].function.parameters as Record<string, unknown>).oneOf;
    assert.deepEqual(result, expected);
    assert.deepEqual(original, before, "must not weaken registered tool definitions or mutate the original payload");
});

test("does not alter other CPAMC accounts, providers, or absent models", () => {
    const hook = setup();
    assert.ok(hook);
    for (const ctx of [
        { model: { provider: "cliproxyapi", id: "main/gpt-6.1-sol" } },
        { model: { provider: "other", id: "mwapi/claude-opus-5-5" } },
        {},
    ]) {
        const original = payload();
        assert.equal(hook({ payload: original }, ctx), undefined);
        assert.ok(original.tools[0].function.parameters.oneOf);
    }
});

test("leaves already compatible requests unchanged", () => {
    const hook = setup();
    assert.ok(hook);
    const compatible = payload();
    delete (compatible.tools[0].function.parameters as Record<string, unknown>).oneOf;
    for (const value of [compatible, {}, null, { tools: [] }, { tools: [{ type: "custom" }] }]) {
        assert.equal(hook({ payload: value }, mwapi), undefined);
    }
});

test("does not discard root unions when there is no complete base object schema", () => {
    const hook = setup();
    assert.ok(hook);
    const original = payload();
    delete (original.tools[0].function.parameters as Record<string, unknown>).properties;
    assert.equal(hook({ payload: original }, mwapi), undefined);
    assert.ok(original.tools[0].function.parameters.oneOf);
});
