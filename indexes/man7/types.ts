export type man7_entry = {
    page_title: string;
    path: string;
    short_description?: string; // corresponds to the "name" field
    //long_description?: string; // corresponds to the "description field"
    synopsis?: string;
}

export type man7_index = man7_entry[];

export type WorkerJob = {
    path: string;
    url: string;
};

export type WorkerResponse = man7_entry | null;
