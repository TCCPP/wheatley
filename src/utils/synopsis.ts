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
                this.synopsis += token;
            } else if (!this.did_elipses) {
                if (code_mode && !this.synopsis.endsWith("\n")) {
                    this.synopsis += "\n";
                }
                this.synopsis += "...";
                this.did_elipses = true;
            }
            // line end logic
            if (ends_line && !this.did_elipses) {
                this.finish_line(false);
                if (!this.reached_max()) {
                    this.synopsis += "\n";
                }
            }
        }
    }

    private finish_line(do_write_line = true) {
        if (!this.synopsis.endsWith("\n") && this.synopsis != "") {
            if (do_write_line) {
                this.synopsis += "\n";
            }
            this.current_line_count++;
            this.current_line_length = 0;
        }
    }

    private reached_max() {
        return this.current_line_count > synopsis_lines;
    }

    private build_synopsis(node: markdown_node) {
        if (this.reached_max()) {
            return;
        }
        switch (node.type) {
            case "doc":
                node.content.forEach(this.build_synopsis.bind(this));
                break;
            case "plain":
                this.write_text(node.content);
                break;
            case "inline_code":
                this.synopsis += `\``;
                this.write_text(node.content);
                this.synopsis += `\``;
                break;
            case "code_block":
                this.finish_line(false);
                this.synopsis += `\`\`\`${node.language ?? ""}\n`;
                this.write_text(node.content, true);
                this.synopsis += `\n\`\`\``;
                break;
            case "italics":
                this.synopsis += `*`;
                this.build_synopsis(node.content);
                this.synopsis += `*`;
                break;
            case "bold":
                this.synopsis += `**`;
                this.build_synopsis(node.content);
                this.synopsis += `**`;
                break;
            case "underline":
                this.synopsis += `__`;
                this.build_synopsis(node.content);
                this.synopsis += `__`;
                break;
            case "strikethrough":
                this.synopsis += `~~`;
                this.build_synopsis(node.content);
                this.synopsis += `~~`;
                break;
            case "spoiler":
                this.synopsis += `||`;
                this.build_synopsis(node.content);
                this.synopsis += `||`;
                break;
            case "masked_link":
                this.synopsis += `[`;
                this.build_synopsis(node.content);
                this.synopsis += `](${node.target})`;
                break;
            case "header":
                // always using level 3 to reduce size
                this.finish_line();
                this.synopsis += `### `;
                this.build_synopsis(node.content);
                this.finish_line();
                break;
            case "blockquote":
                this.finish_line();
                this.synopsis += `> `;
                this.build_synopsis(node.content);
                this.finish_line();
                break;
            case "subtext":
                this.finish_line();
                this.synopsis += `-# `;
                this.build_synopsis(node.content);
                this.finish_line();
                break;
            case "list":
                this.list_depth++;
                for (const item of node.items) {
                    this.finish_line();
                    this.synopsis += "  ".repeat(this.list_depth - 1);
                    this.synopsis += `${node.start_number ? `${node.start_number}.` : "-"} `;
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
