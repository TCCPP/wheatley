export type cppref_page = {
    title: string;
    path: string;
    headers: string[];
};

export type cppref_index = {
    c: cppref_page[];
    cpp: cppref_page[];
};
