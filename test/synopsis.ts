import { describe, expect, it } from "vitest";

import { Synopsinator } from "../src/utils/synopsis.js";

describe("synopsis", () => {
    it("should handle simple paragraphs", () => {
        expect(Synopsinator.make_synopsis("Hello, World")).toBe("Hello, World");
        expect(
            Synopsinator.make_synopsis(
                // eslint-disable-next-line max-len
                "Lorem ipsum dolor sit amet, consectetur adipiscing elit. In eget ante ullamcorper, tincidunt arcu nec, rutrum arcu. Sed sodales tincidunt arcu a lacinia. Praesent nisl lorem, dapibus sit amet massa in, sodales fringilla nibh. Duis tincidunt neque vitae purus lacinia pellentesque. Sed vestibulum neque ac magna cursus, quis ullamcorper urna rhoncus. Duis scelerisque mauris sed dui viverra convallis at sodales risus. Suspendisse potenti. Ut dictum nunc vel velit luctus, et sagittis velit lobortis.",
            ),
        ).toBe(
            // eslint-disable-next-line max-len
            "Lorem ipsum dolor sit amet, consectetur adipiscing elit. In eget ante ullamcorper, tincidunt arcu nec, rutrum arcu. Sed sodales tincidunt arcu a lacinia. Praesent nisl lorem, dapibus sit amet massa in, sodales fringilla nibh. Duis tincidunt neque vitae purus lacinia pellentesque. Sed vestibulum neque ac magna cursus, quis ullamcorper urna rhoncus. Duis scelerisque mauris sed dui viverra convallis at sodales risus. Suspendisse potenti. Ut dictum nunc vel velit luctus, et sagittis velit lobortis.",
        );
        expect(
            Synopsinator.make_synopsis(
                // eslint-disable-next-line max-len
                "Lorem ipsum dolor sit amet, consectetur adipiscing elit. In eget ante ullamcorper, tincidunt arcu nec, rutrum arcu. Sed sodales tincidunt arcu a lacinia. Praesent nisl lorem, dapibus sit amet massa in, sodales fringilla nibh. Duis tincidunt neque vitae purus lacinia pellentesque. Sed vestibulum neque ac magna cursus, quis ullamcorper urna rhoncus. Duis scelerisque mauris sed dui viverra convallis at sodales risus. Suspendisse potenti. Ut dictum nunc vel velit luctus, et sagittis velit lobortis.\n\nfoo bar baz",
            ),
        ).toBe(
            // eslint-disable-next-line max-len
            "Lorem ipsum dolor sit amet, consectetur adipiscing elit. In eget ante ullamcorper, tincidunt arcu nec, rutrum arcu. Sed sodales tincidunt arcu a lacinia. Praesent nisl lorem, dapibus sit amet massa in, sodales fringilla nibh. Duis tincidunt neque vitae purus lacinia pellentesque. Sed vestibulum neque ac magna cursus, quis ullamcorper urna rhoncus. Duis scelerisque mauris sed dui viverra convallis at sodales risus. Suspendisse potenti. Ut dictum nunc vel velit luctus, et sagittis velit lobortis....",
        );
    });
    it("should handle basic formatting", () => {
        expect(Synopsinator.make_synopsis("foo `bar` foo *bar* foo **bar** foo __bar__ foo ~~bar~~ foo ||bar||")).toBe(
            "foo `bar` foo *bar* foo **bar** foo __bar__ foo ~~bar~~ foo ||bar||",
        );
        expect(Synopsinator.make_synopsis("foo [bar](https://google.com)")).toBe("foo [bar](https://google.com)");
    });
    it("should handle formatting for block items", () => {
        expect(Synopsinator.make_synopsis("foo\n# bar\n")).toBe("foo\n### bar\n");
        expect(Synopsinator.make_synopsis("foo\n-# bar\n")).toBe("foo\n-# bar\n");
        expect(Synopsinator.make_synopsis("foo\n> bar\n")).toBe("foo\n> bar\n");
        expect(Synopsinator.make_synopsis("foo\n- bar\n- bar\n  - bar\n")).toBe("foo\n- bar\n- bar\n  - bar\n");
    });
    it("should handle truncations in formatting", () => {
        expect(
            Synopsinator.make_synopsis(
                // eslint-disable-next-line max-len
                "***Lorem ipsum dolor sit amet, consectetur adipiscing elit. In eget ante ullamcorper, tincidunt arcu nec, rutrum arcu. Sed sodales tincidunt arcu a lacinia. Praesent nisl lorem, dapibus sit amet massa in, sodales fringilla nibh. Duis tincidunt neque vitae purus lacinia pellentesque. Sed vestibulum neque ac magna cursus, quis ullamcorper urna rhoncus. Duis scelerisque mauris sed dui viverra convallis at sodales risus. Suspendisse potenti. Ut dictum nunc vel velit luctus, et sagittis velit lobortis. Fusce pellentesque volutpat orci vitae pharetra. Nullam iaculis nibh dolor, vel mollis velit viverra ut. Praesent*** __tellus lectus, bibendum et nisi vitae, semper viverra sem. Nam id mauris ultrices, mollis tellus quis, dapibus diam. Integer vitae orci dolor. Vestibulum imperdiet lectus nec viverra lobortis. Suspendisse ullamcorper metus eget risus faucibus, sit amet sodales quam semper. In ut leo ex. Curabitur at tortor eget massa pellentesque egestas vel a nulla. Ut eget gravida risus, id rhoncus purus. Vestibulum vitae magna urna. Vivamus imperdiet lorem leo, at varius ipsum ornare et. Nullam condimentum imperdiet sapien eu pellentesque.__",
            ),
        ).toBe(
            // eslint-disable-next-line max-len
            "***Lorem ipsum dolor sit amet, consectetur adipiscing elit. In eget ante ullamcorper, tincidunt arcu nec, rutrum arcu. Sed sodales tincidunt arcu a lacinia. Praesent nisl lorem, dapibus sit amet massa in, sodales fringilla nibh. Duis tincidunt neque vitae purus lacinia pellentesque. Sed vestibulum neque ac magna cursus, quis ullamcorper urna rhoncus. Duis scelerisque mauris sed dui viverra convallis at sodales risus. Suspendisse potenti. Ut dictum nunc vel velit luctus, et sagittis velit lobortis. Fusce pellentesque volutpat orci vitae...***",
        );
        expect(
            Synopsinator.make_synopsis(
                // eslint-disable-next-line max-len
                "[Lorem ipsum dolor sit amet, consectetur adipiscing elit. In eget ante ullamcorper, tincidunt arcu nec, rutrum arcu. Sed sodales tincidunt arcu a lacinia. Praesent nisl lorem, dapibus sit amet massa in, sodales fringilla nibh. Duis tincidunt neque vitae purus lacinia pellentesque. Sed vestibulum neque ac magna cursus, quis ullamcorper urna rhoncus. Duis scelerisque mauris sed dui viverra convallis at sodales risus. Suspendisse potenti. Ut dictum nunc vel velit luctus, et sagittis velit lobortis. Fusce pellentesque volutpat orci vitae pharetra. Nullam iaculis nibh dolor, vel mollis velit viverra ut. Praesent tellus lectus, bibendum et nisi vitae, semper viverra sem. Nam id mauris ultrices, mollis tellus quis, dapibus diam. Integer vitae orci dolor. Vestibulum imperdiet lectus nec viverra lobortis. Suspendisse ullamcorper metus eget risus faucibus, sit amet sodales quam semper. In ut leo ex. Curabitur at tortor eget massa pellentesque egestas vel a nulla. Ut eget gravida risus, id rhoncus purus. Vestibulum vitae magna urna. Vivamus imperdiet lorem leo, at varius ipsum ornare et. Nullam condimentum imperdiet sapien eu pellentesque.](https://google.com)",
            ),
        ).toBe(
            // eslint-disable-next-line max-len
            "[Lorem ipsum dolor sit amet, consectetur adipiscing elit. In eget ante ullamcorper, tincidunt arcu nec, rutrum arcu. Sed sodales tincidunt arcu a lacinia. Praesent nisl lorem, dapibus sit amet massa in, sodales fringilla nibh. Duis tincidunt neque vitae purus lacinia pellentesque. Sed vestibulum neque ac magna cursus, quis ullamcorper urna rhoncus. Duis scelerisque mauris sed dui viverra convallis at sodales risus. Suspendisse potenti. Ut dictum nunc vel velit luctus, et sagittis velit lobortis. Fusce pellentesque volutpat orci vitae...](https://google.com)",
        );
    });
    it("should handle truncations in code blocks", () => {
        expect(
            Synopsinator.make_synopsis(
                // eslint-disable-next-line max-len
                'Foo bar baz ```cpp\n#include\n#include\n#include\n#include\n\nint main() {\n    std::cout<<"Hello";\n    std::cout<<"World";\n}```biz',
            ),
        ).toBe(
            // eslint-disable-next-line max-len
            'Foo bar baz ```cpp\n#include\n#include\n#include\n#include\n\nint main() {\n    std::cout<<"Hello";\n    std::cout<<"World";\n...\n```',
        );
    });
});
