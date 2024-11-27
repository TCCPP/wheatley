export type document_fragment = {
    type: "doc";
    content: markdown_node[];
};

export type plain_text = {
    type: "plain";
    content: string;
};

export type formatted_text = {
    type: "format";
    formatter: "*" | "**" | "__" | "~~" | "||";
    content: markdown_node;
};

export type inline_code = {
    type: "inline code";
    content: string;
};

export type code_block = {
    type: "code";
    language: string | null;
    content: string;
};

export type header = {
    type: "header";
    level: number;
    content: markdown_node;
};

export type subtext = {
    type: "subtext";
    content: markdown_node;
};

export type masked_link = {
    type: "masked link";
    target: string;
    content: markdown_node;
};

export type list = {
    type: "list";
    start_number: number | null;
    items: markdown_node[];
};

export type blockquote = {
    type: "blockquote";
    content: markdown_node;
};

export type markdown_node =
    | document_fragment
    | plain_text
    | formatted_text
    | inline_code
    | code_block
    | header
    | subtext
    | masked_link
    | list
    | blockquote;
