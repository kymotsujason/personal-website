import { test } from "node:test";
import assert from "node:assert/strict";
import { readContributions, fillGraph } from "./github.js";

const DAYS = [{ date: "2026-10-14", level: 0 }, { date: "2026-10-15", level: 4 }];

test("the home route's github part reads back as days and a total", () => {
    assert.deepEqual(readContributions({ days: DAYS, total: 12 }), { days: DAYS, total: 12 });
});

test("a missing github part gives null, for the empty grid", () => {
    assert.equal(readContributions(null), null);
    assert.equal(readContributions({ days: DAYS }), null);
    assert.equal(readContributions({ days: "DAYS", total: 12 }), null);
});

test("a day without a date or with a level outside 0 to 4 gives null", () => {
    assert.equal(readContributions({ days: [{ level: 1 }], total: 1 }), null);
    assert.equal(readContributions({ days: [{ date: "2026-10-15", level: 5 }], total: 1 }), null);
    assert.equal(readContributions({ days: [{ date: "2026-10-15", level: "2" }], total: 1 }), null);
});

test("a day whose date isn't a real yyyy-mm-dd day gives null", () => {
    ["Oct 15, 2026", "2026-10-15T00:00:00Z", "2026-13-45", ""].forEach((date) => {
        assert.equal(readContributions({ days: [...DAYS, { date, level: 1 }], total: 1 }), null, date);
    });
});

// just enough of the dom for fillGraph: a graph two weeks wide that keeps the cells it's given
const fakeGraph = () => {
    const cells = [];
    globalThis.document = { createElement: () => ({ style: {} }) };
    return { clientWidth: 25, cells, set innerHTML(html) {
        cells.length = 0;
    }, appendChild: (cell) => cells.push(cell) };
};

test("a last day the graph can't read still fills the grid, ending on a saturday", () => {
    const graph = fakeGraph();
    fillGraph(graph, { days: [{ date: "2026-10-14", level: 2 }, { date: "Oct 15", level: 4 }], total: 6 });
    assert.equal(graph.cells.length, 14);
    assert.equal(graph.cells[13].style.background, "#39d353");
    delete globalThis.document;
});
