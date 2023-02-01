import { assert, expect } from "chai";

import * as BezierEasing from "bezier-easing";

const B = BezierEasing(0.6, 0.35, 0.96, 0.74);

describe("Bezier Tests", () => {
    it("should compute the right values", done => {
        assert(B(0) == 0);
        assert(B(1) == 1);
        assert(B(0.7) == 0.523597936538993);
        done();
    });
});
