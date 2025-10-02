import { markdown_node, MarkdownParser } from "dismark";

const synopsis_lines = 7;
const estimated_embed_line_width = 70;

export class Synopsinator {
    private synopsis = "";
    private current_line_count = 0;
    private current_line_length = 0;
    private did_elipses = false;
    private list_depth = 0;

    static make_synopsis(message: string) {
        const inator = new Synopsinator();
        inator.build_synopsis(new MarkdownParser().parse(message));
        return inator.synopsis;
    }

    private write_text(text: string, code_mode = false) {
        const tokens = text.split(/(?= )|(?<=\n)/gi); // split before spaces or after newlines
        for (let token of tokens) {
            const ends_line = token.endsWith("\n");
            if (ends_line) {
                token = token.substring(0, token.length - 1);
            }
            // book keep token append, if we go over the line length pretend we reset the line
            if (this.current_line_length + token.length > estimated_embed_line_width) {
                this.finish_line(false);
            }
            // add in token length
            this.current_line_length += token.length;
            // now actually do the token append, so long as we don't go over
            if (!this.reached_max()) {
                this.add_to_output(token);
            } else if (!this.did_elipses) {
                if (code_mode && !this.synopsis.endsWith("\n")) {
                    this.add_to_output("\n");
                }
                this.add_to_output("...");
                this.did_elipses = true;
            }
            // line end logic
            if (ends_line && !this.did_elipses) {
                this.finish_line(false);
                if (!this.reached_max()) {
                    this.add_to_output("\n");
                }
            }
        }
    }

    private finish_line(do_write_line = true) {
        if (!this.synopsis.endsWith("\n") && this.synopsis != "") {
            if (do_write_line) {
                this.add_to_output("\n");
            }
            this.current_line_count++;
            this.current_line_length = 0;
        }
    }

    private reached_max() {
        return this.current_line_count > synopsis_lines;
    }

    private add_to_output(text: string) {
        this.synopsis += text;
    }

    private build_synopsis(node: markdown_node): void {
        if (this.reached_max()) {
            return;
        }
        switch (node.type) {
            case "doc":
                node.content.forEach(n => this.build_synopsis(n));
                break;
            case "plain":
                this.write_text(node.content);
                break;
            case "inline_code":
                this.add_to_output(`\``);
                this.write_text(node.content);
                this.add_to_output(`\``);
                break;
            case "code_block":
                this.finish_line(false);
                this.add_to_output(`\`\`\`${node.language ?? ""}\n`);
                this.write_text(node.content, true);
                this.add_to_output(`\n\`\`\``);
                break;
            case "italics":
                this.add_to_output(`*`);
                this.build_synopsis(node.content);
                this.add_to_output(`*`);
                break;
            case "bold":
                this.add_to_output(`**`);
                this.build_synopsis(node.content);
                this.add_to_output(`**`);
                break;
            case "underline":
                this.add_to_output(`__`);
                this.build_synopsis(node.content);
                this.add_to_output(`__`);
                break;
            case "strikethrough":
                this.add_to_output(`~~`);
                this.build_synopsis(node.content);
                this.add_to_output(`~~`);
                break;
            case "spoiler":
                this.add_to_output(`||`);
                this.build_synopsis(node.content);
                this.add_to_output(`||`);
                break;
            case "masked_link":
                this.add_to_output(`[`);
                this.build_synopsis(node.content);
                this.add_to_output(`](${node.target})`);
                break;
            case "header":
                // always using level 3 to reduce size
                this.finish_line();
                this.add_to_output(`### `);
                this.build_synopsis(node.content);
                this.finish_line();
                break;
            case "blockquote":
                this.finish_line();
                this.add_to_output(`> `);
                this.build_synopsis(node.content);
                this.finish_line();
                break;
            case "subtext":
                this.finish_line();
                this.add_to_output(`-# `);
                this.build_synopsis(node.content);
                this.finish_line();
                break;
            case "list":
                this.list_depth++;
                for (const item of node.items) {
                    this.finish_line();
                    this.add_to_output("  ".repeat(this.list_depth - 1));
                    this.add_to_output(`${node.start_number ? `${node.start_number}.` : "-"} `);
                    this.build_synopsis(item);
                    this.finish_line();
                }
                this.list_depth--;
                break;
            default:
                throw new Error(`Unhandled markdown ast node type ${(node as any).type}`);
        }
    }
}
