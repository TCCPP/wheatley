export type cppref_page = {
    title: string;
    path: string;
    wgPageName: string;
    headers?: string[];
    sample_declaration?: string;
};

export type cppref_index = {
    c: cppref_page[];
    cpp: cppref_page[];
};

export enum CpprefSubIndex { C, CPP }

export type WorkerJob = {
    path: string;
    target_index: CpprefSubIndex;
};


export type WorkerResponse = {
    entry: cppref_page;
    target_index: CpprefSubIndex;
};
